# Changelog

All notable changes are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-20

### Added
- `DenoExecutor`, an implementation of the `Executor` interface from `@cloudflare/codemode` that runs generated code in a Deno subprocess with every permission denied.
- Options: `timeout`, `memoryLimitMb`, `allowNet`, `maxOutputBytes`, `denoPath`. `executor.denoArgs` exposes the exact sandbox flags.
- Tool name sanitizing, provider validation, `[warn]`/`[error]` log prefixes, preludes and the never-throw contract, matching upstream.
- `sanitizeToolName` and the executor types, re-exported for typing.
- `bench/latency.mjs` and `examples/see-it-work.mjs`.

### Security
- The host treats every stdout line from the sandbox as untrusted. Malformed lines written from a `Worker` inside the sandbox could crash the host process.
- Tool lookups use own properties only, so `codemode.constructor()` and similar no longer call `Object.prototype` methods on the host.
- A tool that throws a value with no string form no longer causes an unhandled rejection on the host.
- The host waits for the process `close` event, so the final `done` line is always read before the sandbox is reported as dead.

[Unreleased]: https://github.com/Parthkomalwad/codemode-deno-executor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Parthkomalwad/codemode-deno-executor/releases/tag/v0.1.0
