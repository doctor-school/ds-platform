# `@ds/tsconfig`

The DS Platform **shared TypeScript configuration** — the base `tsconfig` presets
that apps and packages `extends`, so compiler options (target, module resolution,
strictness) stay uniform across the monorepo.

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/tsconfig`, `private`). The shared base configs
(`base.json`, app/library variants) land when the presets are extracted here.
Until then each package carries its own `tsconfig.json`.

## Public surface

_None yet_ — the exported `tsconfig` presets (referenced via `extends`) arrive
when populated. This is a config-only package: no runtime code, no build.

## Build / test

Config-only — no scripts. Type-checking happens in the consuming packages
(`pnpm typecheck` / `turbo run typecheck` at the root).

## Related

- **ADR-0008** — repo strategy & dev workflow (monorepo tooling conventions).
