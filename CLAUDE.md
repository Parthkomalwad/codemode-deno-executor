# CLAUDE.md: codemode-deno-executor

## What this project is

A sandboxed executor for Cloudflare's `@cloudflare/codemode`. `DenoExecutor` implements Code Mode's `Executor` interface and runs model-generated code in a `deno run` subprocess with every permission denied. Host and sandbox talk newline-delimited JSON over stdio.

```
src/index.ts       host side: DenoExecutor, options, sanitizeToolName, protocol handling
src/types.ts       structural copies of upstream's Executor types (main entry can't load in Node)
runner/runner.js   sandbox side: runs inside Deno, no permissions
test/              node:test suite, spawns real Deno processes; types-compat.ts checks the type at build time
bench/latency.mjs  latency benchmark
examples/          runnable examples used by the README
```

## Rules

**Match upstream behaviour.** Tool name sanitizing, provider validation, log prefixes, error messages such as `Tool "x" not found`, preludes and result shapes must match `@cloudflare/codemode`'s executors. Check upstream source in `node_modules/@cloudflare/codemode/dist/` before changing any of these. Document every intentional difference in the README.

**`execute` never throws.** Every failure, including a missing Deno binary, a crash, a timeout or bad input, returns `{ result: undefined, error, logs }`. Never let a rejection or exception escape to the caller or become unhandled on the host.

**Every fix needs a test.** The test must fail without the fix. Tests run real Deno processes; do not mock the sandbox.

**Treat the sandbox as hostile.** Anything read from the child process is untrusted, even though the runner is ours: generated code can write to stdout from a `Worker`. Never let a sandbox message throw on the host. Never widen Deno permissions by default.

**Do not change the public API** (`DenoExecutor`, `DenoExecutorOptions`, the re-exported types, `sanitizeToolName`) without asking first.

**No invented numbers.** Benchmarks, timings and transcripts in docs must come from a command that was actually run, with the machine noted.

## Commands

```sh
npm ci
npm test              # build + type-check + tests
node bench/latency.mjs
```

## Style

TypeScript strict, ES2022, no runtime dependencies. Short sentences in docs, no em dashes, no marketing words. Conventional Commits.
