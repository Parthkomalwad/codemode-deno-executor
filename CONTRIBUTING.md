# Contributing

## Where to start

1. Read [CLAUDE.md](CLAUDE.md). Its rules apply to people and AI sessions alike.
2. For anything larger than a small fix, open an issue first so we can agree on the approach.
3. For security problems, follow [SECURITY.md](SECURITY.md). Do not open a public issue.

## Development environment

You need Node 20+ and Deno 2.

```sh
npm ci
npm test            # build, type-check against @cloudflare/codemode, run all tests
node bench/latency.mjs
```

Tests spawn real Deno processes. There are no mocks of the sandbox.

## Rules for pull requests

- One logical change per PR. Refactors and behaviour changes are separate PRs.
- Every bug fix comes with a test that fails without the fix.
- Behaviour matches upstream `@cloudflare/codemode` executors unless the README documents the difference.
- Do not change the public API (`DenoExecutor`, `DenoExecutorOptions`, the re-exported types, `sanitizeToolName`) without an issue first.
- No new runtime dependencies without a written argument in the PR.
- Update `CHANGELOG.md` under *Unreleased*.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`. Short imperative subject. The body explains why.
