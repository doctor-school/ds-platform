# `@ds/eslint-config`

The DS Platform **shared ESLint configuration** — the workspace-wide lint ruleset
that apps and packages extend, so code style and the project's lint guards stay
consistent across the monorepo (the guard family surfaces as CI Checks; see
AGENTS.md §5 and `.github/workflows/ci.yml`).

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/eslint-config`, `private`). The shared flat-config
presets land when the config is extracted here. Until then repo linting runs from
the root `eslint.config` and `pnpm lint`.

## Public surface

_None yet_ — the exported ESLint flat-config preset(s) arrive when populated.

## Build / test

Config-only package — no build. Lint runs at the root:

```bash
pnpm lint   # eslint . + oxlint + stylelint + turbo run lint
```

## Related

- **AGENTS.md §5** + `.github/workflows/ci.yml` — the CI lint-guard family
  (ADR-0007 §2.6).
