# `@ds/promo`

The DS Platform **promo / marketing site** — the public landing surface for
Doctor.School, one of the four Next.js frontends (ADR-0004: promo / portal /
admin / cms-Payload-v3). Built on the shared `@ds/design-system` like the other
web apps.

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/promo`, `private`). The Next.js app shell and marketing
pages land in a later vertical. Until then it declares no build/dev scripts and
ships nothing (it is not part of the deployed 003 auth scope).

## Public surface

_None yet_ — the Next.js routes + marketing pages arrive with the promo vertical.

## Build / test

No package-local scripts yet. Once scaffolded it will follow the workspace
convention (`pnpm --filter @ds/promo dev|build|typecheck`); today it is a no-op in
`turbo run` fan-outs.

## Owning ADR

- **ADR-0004** — frontend stack (Next.js 15 + `@ds/design-system`).
