# `@ds/account` — the one account cabinet

The ONE canonical `/account` surface (003 «Account profile v1», EARS-27/28;
epic #2020 wave 4, #2073), mounted by the storefronts from their `/account`
route with a data-only host config. Cross-front capability reuse is a hard rule
(AGENTS.md §6, ADR-0013 A1) — a second cabinet controller in a host is a
defect. Registry row: «Account profile surface» in
`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`. Gate:
`apps/docs/content/specs/tech/2026-10-20-account-room-wave-4-entry-gate-en.md`.
Canvas: `design-source/account-profile.dc.html` (the «Разделы» variant, `host`
prop).

Since wave-4 PR 4.1 the package holds the Academy cabinet moved from
`apps/portal/app/account/`: the server guest guard, the client controller (the
EARS-27 self-read, the 003 EARS-9 silent refresh + retry, the inline
display-name write, sign-out, the phone row's shared doors) over the shared
`AccountProfileCard` block, and the default RU copy. The Academy mounts it at
`/account` (`ACADEMY_ACCOUNT`); the doctor storefront mounts it in PR 4.2.

## Why a package of its own (gate D1)

The doctor cabinet's «Мои заявки на Конгресс» row (046 EARS-4) reads
`@ds/congress-submissions/client`, and `@ds/congress-submissions` imports
`@ds/auth-flow`; the cabinet inside `@ds/auth-flow` would close a cycle. So
`@ds/account` sits above both in `PACKAGE_GRAPH`
(`eslint.import-boundary.config.mjs`): it imports `@ds/schemas`,
`@ds/design-system`, `@ds/room` (`./display-name`), `@ds/auth-flow` and
`@ds/congress-submissions`, and nothing imports it.

## Layout

| Path              | Holds                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/**`       | `AccountPage` (server: the guest guard, `withReturnContext` bounce) and `AccountCabinet` (`"use client"`: the controller over the shared card) |
| `src/copy/**`     | `ACCOUNT_COPY` — every fixed sentence of the cabinet, the Academy's `account` catalogue moved verbatim (gate row 15)                           |
| `src/host-config` | `AccountHostConfig` — the data a host states (gate D1)                                                                                         |

The transport is the host's bound `@ds/auth-flow` client, built from
`authFlow.api` (`profile`, `refresh`, `setDisplayName`, `logout`, the phone
doors — gate D2). Every carried target (the guest bounce, the expired-session
bounce, the «Сменить пароль» handoff) is `withReturnContext` over the host's
`authFlow.routes` (gate D3). Sign-out lands on `SIGN_OUT_DESTINATION` (#2488),
a package constant.

## Exports

| Subpath         | Contract                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | `AccountHostConfig` (type), `ACCOUNT_COPY`                                                                                                                                                        |
| `./page`        | `AccountPage({ config })` — the route mount: a host route file renders it with its host config and nothing else, keeps its own `metadata`, and declares `dynamic = "force-dynamic"` itself        |
| `./host-config` | `AccountHostConfig` — `authFlow` (the host's `@ds/auth-flow` config), `eventsHref` (the host's `routes.accountEvents`), `congress: { path } \| null`; data only, the closed adapter list is empty |

## Host wiring

A mounting host lists `@ds/account` and `@ds/congress-submissions` in
`next.config` `transpilePackages` and `@source`s `packages/account/src` in its
`globals.css` — undeclared, the cabinet's utilities are purged in the Docker
build. The package ships no runtime files, so it needs no
`outputFileTracingIncludes` entry.

## Tests

`pnpm -F @ds/account test` (Vitest, jsdom). The mounted route is covered by the
Academy e2e (`apps/portal/e2e/{auth-journeys.e2e,my-events}.spec.ts`,
`apps/portal/e2e/a11y/a11y-axe.e2e.spec.ts`).
