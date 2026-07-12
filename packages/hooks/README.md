# `@ds/hooks`

The DS Platform **shared React hooks** — reusable client-side hooks for the
Next.js apps (`@ds/portal`, later `@ds/admin` / `@ds/promo` / `@ds/cms`), kept
here so behavior (data fetching, UI state helpers) is not re-implemented per app.
Pairs with `@ds/design-system` (components) and `@ds/utils` (framework-agnostic
helpers).

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/hooks`, `private`). The hooks land as verticals extract
shared client behavior. Until then it declares no scripts and exports nothing.

## Public surface

_None yet_ — the exported hooks arrive when populated. Following the design-system
convention, they will ship as **source `.tsx`** consumed via `transpilePackages`.

## Build / test

No package-local scripts yet; type-checked/tested through the workspace root
(`pnpm typecheck` / `pnpm test`, `turbo run`). Today it is a no-op in those
fan-outs.

## Owning ADR

- **ADR-0004** — frontend stack (the Next.js apps that consume these hooks).
