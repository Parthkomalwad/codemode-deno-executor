// Sandbox runtime for codemode-deno-executor.
//
// This file runs INSIDE the Deno subprocess, with every permission denied by
// the host (no network, filesystem, env, subprocesses, FFI or system info).
// It talks to the host over newline-delimited JSON on stdin/stdout:
//
//   host -> sandbox  {"t":"init","code":"...","providers":[{"name","prelude"}]}
//   sandbox -> host  {"t":"log","line":"..."}
//   sandbox -> host  {"t":"call","id":1,"ns":"codemode","tool":"search","args":[...]}
//   host -> sandbox  {"t":"ret","id":1,"result":...}   or   {"t":"ret","id":1,"error":"..."}
//   sandbox -> host  {"t":"done","result":...}         or   {"t":"done","error":"..."}

const encoder = new TextEncoder();
const stdout = Deno.stdout;
const stdin = Deno.stdin;
const exit = Deno.exit.bind(Deno);

function writeLine(line) {
  const bytes = encoder.encode(line + "\n");
  let written = 0;
  while (written < bytes.length) written += stdout.writeSync(bytes.subarray(written));
}

const send = (message) => writeLine(JSON.stringify(message));

function errorMessage(err) {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "Unknown error";
  }
}

let finished = false;
function finish(message) {
  if (finished) return;
  finished = true;
  send({ t: "done", ...message });
  exit(0);
}

// --- Read messages from the host -------------------------------------------
const pending = new Map();
let nextCallId = 1;
let resolveInit;
const initMessage = new Promise((resolve) => (resolveInit = resolve));

(async () => {
  let buffer = "";
  for await (const chunk of stdin.readable.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.t === "init") {
        resolveInit(message);
      } else if (message.t === "ret") {
        const call = pending.get(message.id);
        if (!call) continue;
        pending.delete(message.id);
        if (typeof message.error === "string") call.reject(new Error(message.error));
        else call.resolve(message.result);
      }
    }
  }
})();

// --- Console capture (same format as Cloudflare's executors) ---------------
function formatArgs(args) {
  return args
    .map((value) => {
      try {
        return String(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    })
    .join(" ");
}
const capture = (prefix) => (...args) => send({ t: "log", line: prefix + formatArgs(args) });
for (const method of ["log", "info", "debug", "trace", "dir", "table"]) console[method] = capture("");
console.warn = capture("[warn] ");
console.error = capture("[error] ");

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  send({ t: "log", line: "[error] Unhandled rejection: " + errorMessage(event.reason) });
});

// --- Tool namespaces --------------------------------------------------------
function callTool(ns, tool, args) {
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    let line;
    try {
      line = JSON.stringify({ t: "call", id, ns, tool, args });
    } catch (err) {
      reject(new Error(`Arguments for ${ns}.${tool}() are not JSON-serializable: ${errorMessage(err)}`));
      return;
    }
    pending.set(id, { resolve, reject });
    writeLine(line);
  });
}

function namespaceProxy(ns) {
  return new Proxy(
    {},
    {
      get(target, key) {
        if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
        // Not tools: stops `await codemode` or JSON.stringify(codemode) from becoming tool calls.
        if (typeof key !== "string" || key === "then" || key === "toJSON") return undefined;
        return (...args) => callTool(ns, key, args);
      },
    },
  );
}

const dataUrl = (source) => "data:application/typescript," + encodeURIComponent(source);

async function loadUserFunction(code) {
  try {
    return (await import(dataUrl(`export default (\n${code}\n);`))).default;
  } catch (expressionError) {
    try {
      // Not a single expression: treat the code as the body of an async function.
      return (await import(dataUrl(`export default async () => {\n${code}\n};`))).default;
    } catch (bodyError) {
      const looksLikeFunction = /^(async\b|\(|function\b)/.test(code.trim());
      throw looksLikeFunction ? expressionError : bodyError;
    }
  }
}

// --- Run --------------------------------------------------------------------
try {
  const { code, providers } = await initMessage;

  for (const provider of providers) {
    if (provider.name in globalThis) {
      finish({ error: `Provider name "${provider.name}" is reserved` });
    }
    globalThis[provider.name] = namespaceProxy(provider.name);
  }
  for (const provider of providers) {
    if (provider.prelude) (0, eval)(provider.prelude);
  }

  // Hide the Deno namespace from generated code. Permissions already block
  // anything dangerous; this also stops code from writing to the protocol
  // channel or calling Deno.exit().
  delete globalThis.Deno;

  const fn = await loadUserFunction(code);
  const value = typeof fn === "function" ? await fn() : await fn;

  let serialized;
  try {
    serialized = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  } catch (err) {
    finish({ error: `Result is not JSON-serializable: ${errorMessage(err)}` });
  }
  finish(serialized === undefined ? {} : { result: serialized });
} catch (err) {
  finish({ error: errorMessage(err) });
}
