# `@ds/cms`

The DS Platform **content-management app** — the marketing/content CMS built on
**Payload v3** (ADR-0004: promo / portal / admin / cms-Payload-v3). It owns
editorial content for the public-facing surfaces (distinct from `@ds/docs-cms`,
which manages the engineering docs corpus).

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/cms`, `private`). The Payload app shell, collections,
and admin wiring land in a later vertical. Until then it declares no build/dev
scripts and ships nothing.

## Public surface

_None yet_ — the Payload admin + delivery API arrive with the CMS vertical.

## Build / test

No package-local scripts yet. Once scaffolded it will follow the workspace
convention (`pnpm --filter @ds/cms dev|build|typecheck`); today it is a no-op in
`turbo run` fan-outs (`pnpm build` / `pnpm typecheck` at the root).

## Owning ADR

- **ADR-0004** — frontend stack (the `cms-Payload-v3` app).
