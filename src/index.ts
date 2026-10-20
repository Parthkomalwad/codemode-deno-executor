import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  ExecuteOptions,
  ExecuteResult,
  Executor,
  ResolvedProvider,
  ToolFn,
} from "./types.js";

export type {
  ConnectorBinding,
  ExecuteOptions,
  ExecuteResult,
  Executor,
  ResolvedProvider,
  ToolFn,
} from "./types.js";

export interface DenoExecutorOptions {
  /** Maximum execution time in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Path to the Deno executable. Defaults to `"deno"` (looked up on PATH). */
  denoPath?: string;
  /** V8 heap limit for the sandbox, in megabytes. Defaults to 128. */
  memoryLimitMb?: number;
  /**
   * Outbound network access for sandboxed code.
   * - `false` (default): fetch() and sockets throw, like Cloudflare's `globalOutbound: null`.
   * - `string[]`: only these hosts, e.g. `["api.github.com"]`.
   * - `true`: unrestricted network access.
   */
  allowNet?: boolean | string[];
  /**
   * Maximum bytes the sandbox may send back (logs, tool calls and result
   * combined) before it is stopped. Defaults to 10 MB.
   */
  maxOutputBytes?: number;
}

const DEFAULTS = {
  timeout: 30_000,
  denoPath: "deno",
  memoryLimitMb: 128,
  maxOutputBytes: 10 * 1024 * 1024,
};

const RUNNER_PATH = fileURLToPath(new URL("../runner/runner.js", import.meta.url));

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// Same list Cloudflare uses, so tool names sanitize identically.
const JS_RESERVED = new Set([
  "abstract", "arguments", "await", "boolean", "break", "byte", "case", "catch", "char",
  "class", "const", "continue", "debugger", "default", "delete", "do", "double", "else",
  "enum", "eval", "export", "extends", "false", "final", "finally", "float", "for",
  "function", "goto", "if", "implements", "import", "in", "instanceof", "int", "interface",
  "let", "long", "native", "new", "null", "package", "private", "protected", "public",
  "return", "short", "static", "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "true", "try", "typeof", "undefined", "var", "void", "volatile", "while",
  "with", "yield",
]);

/** Mirrors `sanitizeToolName` from `@cloudflare/codemode`. */
export function sanitizeToolName(name: string): string {
  if (!name) return "_";
  let sanitized = name.replace(/[-.\s]/g, "_").replace(/[^a-zA-Z0-9_$]/g, "");
  if (!sanitized) return "_";
  if (/^[0-9]/.test(sanitized)) sanitized = "_" + sanitized;
  if (JS_RESERVED.has(sanitized)) sanitized += "_";
  return sanitized;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Prepared = { providers: ResolvedProvider[] } | { error: string };

function prepareProviders(providersOrFns: ResolvedProvider[] | Record<string, ToolFn>): Prepared {
  const raw: ResolvedProvider[] = Array.isArray(providersOrFns)
    ? providersOrFns
    : [{ name: "codemode", fns: providersOrFns }];

  const seen = new Set<string>();
  const providers: ResolvedProvider[] = [];
  for (const provider of raw) {
    if (!VALID_IDENTIFIER.test(provider.name) || JS_RESERVED.has(provider.name)) {
      return { error: `Provider name "${provider.name}" is not a valid JavaScript identifier` };
    }
    if (seen.has(provider.name)) return { error: `Duplicate provider name "${provider.name}"` };
    seen.add(provider.name);

    const fns: Record<string, ToolFn> = {};
    const originalNames = new Map<string, string>();
    for (const [name, fn] of Object.entries(provider.fns)) {
      const sanitized = sanitizeToolName(name);
      const existing = originalNames.get(sanitized);
      if (existing !== undefined && existing !== name) {
        return {
          error: `Tool names "${existing}" and "${name}" both sanitize to "${sanitized}" in provider "${provider.name}"`,
        };
      }
      originalNames.set(sanitized, name);
      fns[sanitized] = fn;
    }
    providers.push({ name: provider.name, fns, prelude: provider.prelude });
  }
  return { providers };
}

/**
 * Runs Code Mode's LLM-generated code in a locked-down Deno subprocess.
 *
 * Drop-in replacement for `DynamicWorkerExecutor` outside Cloudflare Workers:
 * each call spawns a fresh Deno process with every permission denied (unless
 * `allowNet` opts in), routes `namespace.tool()` calls back to your host
 * functions over stdio, and never throws: failures come back in `error`.
 */
export class DenoExecutor implements Executor {
  readonly #options: Required<Omit<DenoExecutorOptions, "allowNet">> & {
    allowNet: boolean | string[];
  };

  constructor(options: DenoExecutorOptions = {}) {
    this.#options = {
      timeout: options.timeout ?? DEFAULTS.timeout,
      denoPath: options.denoPath ?? DEFAULTS.denoPath,
      memoryLimitMb: options.memoryLimitMb ?? DEFAULTS.memoryLimitMb,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULTS.maxOutputBytes,
      allowNet: options.allowNet ?? false,
    };
  }

  /** The exact `deno` command-line flags the sandbox runs with. */
  get denoArgs(): string[] {
    const { allowNet, memoryLimitMb } = this.#options;
    const net =
      allowNet === true
        ? "--allow-net"
        : Array.isArray(allowNet) && allowNet.length > 0
          ? `--allow-net=${allowNet.join(",")}`
          : "--deny-net";
    return [
      "run",
      "--quiet",
      "--no-prompt",
      "--no-config",
      "--no-lock",
      "--no-npm",
      "--no-remote",
      net,
      "--deny-read",
      "--deny-write",
      "--deny-env",
      "--deny-run",
      "--deny-ffi",
      "--deny-sys",
      `--v8-flags=--max-old-space-size=${memoryLimitMb}`,
      RUNNER_PATH,
    ];
  }

  async execute(
    code: string,
    providersOrFns: ResolvedProvider[] | Record<string, ToolFn>,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    try {
      if (options?.connectors?.length) {
        return {
          result: undefined,
          error: "DenoExecutor does not support connectors (Cloudflare Workers RPC only); pass them as providers instead",
        };
      }
      const prepared = prepareProviders(providersOrFns);
      if ("error" in prepared) return { result: undefined, error: prepared.error };
      return await this.#run(code, prepared.providers);
    } catch (err) {
      return { result: undefined, error: errorMessage(err) };
    }
  }

  #run(code: string, providers: ResolvedProvider[]): Promise<ExecuteResult> {
    const { denoPath, timeout, maxOutputBytes } = this.#options;
    const logs: string[] = [];
    const byName = new Map(providers.map((p) => [p.name, p.fns]));

    return new Promise<ExecuteResult>((resolve) => {
      let settled = false;
      let stderr = "";
      let outputBytes = 0;

      const child = spawn(denoPath, this.denoArgs, {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        // Only what Deno itself needs; the sandbox can't read env vars anyway.
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
          NO_COLOR: "1",
          DENO_NO_UPDATE_CHECK: "1",
        },
      });

      const settle = (result: Omit<ExecuteResult, "logs">) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve({ ...result, logs });
      };

      const timer = setTimeout(
        () => settle({ result: undefined, error: "Execution timed out" }),
        timeout,
      );

      const send = (message: unknown) => {
        if (settled || !child.stdin.writable) return;
        child.stdin.write(JSON.stringify(message) + "\n");
      };

      const dispatch = async (id: number, ns: string, tool: string, args: unknown) => {
        const fn = byName.get(ns)?.[tool];
        if (!fn) return send({ t: "ret", id, error: `Tool "${tool}" not found` });
        try {
          const value = await fn(...(Array.isArray(args) ? args : [args]));
          let result: unknown;
          try {
            result = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
          } catch (err) {
            return send({ t: "ret", id, error: `Result of ${ns}.${tool}() is not JSON-serializable: ${errorMessage(err)}` });
          }
          send({ t: "ret", id, result });
        } catch (err) {
          send({ t: "ret", id, error: errorMessage(err) });
        }
      };

      child.on("error", (err: NodeJS.ErrnoException) => {
        settle({
          result: undefined,
          error:
            err.code === "ENOENT"
              ? `Deno executable not found ("${denoPath}"). Install Deno from https://deno.com or set the denoPath option.`
              : `Failed to start Deno: ${err.message}`,
        });
      });
      child.stdin.on("error", () => {}); // the sandbox may exit before we finish writing

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk;
      });

      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > maxOutputBytes) {
          settle({ result: undefined, error: `Sandbox output exceeded ${maxOutputBytes} bytes` });
          return;
        }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message: any;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.t === "log") logs.push(String(message.line));
          else if (message.t === "call") void dispatch(message.id, message.ns, message.tool, message.args);
          else if (message.t === "done") {
            settle(
              typeof message.error === "string"
                ? { result: undefined, error: message.error }
                : { result: message.result },
            );
          }
        }
      });

      child.on("exit", (exitCode, signal) => {
        if (settled) return;
        const detail = stderr.trim().split("\n").slice(-3).join("\n");
        const outOfMemory = /out of memory|heap limit/i.test(stderr);
        settle({
          result: undefined,
          error: outOfMemory
            ? `Sandbox ran out of memory (limit ${this.#options.memoryLimitMb} MB)`
            : `Sandbox exited unexpectedly (${signal ?? `exit code ${exitCode}`})${detail ? `: ${detail}` : ""}`,
        });
      });

      send({
        t: "init",
        code,
        providers: providers.map((p) => ({ name: p.name, prelude: p.prelude })),
      });
    });
  }
}
