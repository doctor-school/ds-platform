# `@ds/utils`

The DS Platform **shared utility helpers** — small, framework-agnostic functions
reused across apps and packages (formatting, guards, general helpers), kept here
so they are not re-implemented per surface. Pairs with `@ds/hooks` (React-specific
client behavior) and `@ds/design-system` (UI).

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/utils`, `private`). Helpers land here as shared logic is
extracted from the verticals. Until then it declares no scripts and exports
nothing.

## Public surface

_None yet_ — the exported helpers arrive when populated. Being framework-agnostic,
it should depend on no UI or backend framework.

## Build / test

No package-local scripts yet; type-checked/tested through the workspace root
(`pnpm typecheck` / `pnpm test`, `turbo run`). Today it is a no-op in those
fan-outs.
