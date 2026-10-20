/**
 * Structural copies of the executor contract from `@cloudflare/codemode`.
 *
 * They are declared here instead of imported because the package's main
 * entry pulls in the Workers-only `cloudflare:workers` module, which plain
 * Node can't load. TypeScript compares types by shape, so a `DenoExecutor`
 * is accepted anywhere `@cloudflare/codemode` expects an `Executor`
 * (test/types-compat.ts checks this at build time).
 */

export type ToolFn = (...args: unknown[]) => Promise<unknown>;

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
}

export interface ResolvedProvider {
  name: string;
  fns: Record<string, ToolFn>;
  /** Sandbox-side JavaScript run after the provider's namespace is created. */
  prelude?: string;
}

export interface ConnectorBinding {
  name: string;
  binding: { callTool(method: string, args: unknown): Promise<unknown> };
}

export interface ExecuteOptions {
  /** Workers RPC connectors. Not supported outside Cloudflare Workers. */
  connectors?: ConnectorBinding[];
}

export interface Executor {
  execute(
    code: string,
    providersOrFns: ResolvedProvider[] | Record<string, ToolFn>,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult>;
}
