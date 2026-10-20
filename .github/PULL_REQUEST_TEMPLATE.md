## What

<!-- One paragraph. Link the issue if there is one. -->

## Why

<!-- The problem or the user-visible outcome, not a restatement of the diff. -->

## How to verify

```sh
npm ci && npm test
```

## Checklist

- [ ] `npm test` passes locally
- [ ] Every bug fix has a test that fails without it
- [ ] Follows `CLAUDE.md` (matches upstream behaviour, `execute` never throws)
- [ ] No public API change, or there is an issue agreeing to it
- [ ] If the sandbox boundary changed: `SECURITY.md` updated
- [ ] `CHANGELOG.md` *Unreleased* updated
