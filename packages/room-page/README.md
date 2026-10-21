# `@ds/room-page` — the one live-room route mount

The ONE live-room route (006 «Webinar room», EARS-1/2/6/11/14; epic #2020 wave
4, #2073), mounted by the storefronts from their room route with a data-only
host config. Cross-front capability reuse is a hard rule (AGENTS.md §6,
ADR-0013 A1) — a second room page or client wrapper in a host is a defect.
Registry row: «Live room UI (composition)» in
`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`. Gate:
`apps/docs/content/specs/tech/2026-10-20-account-room-wave-4-entry-gate-en.md`
(D9, rows 20–25).

Since wave-4 PR 4.3 the package holds the Academy room glue moved from
`apps/portal/app/webinars/[slug]/room/`: the server page and the client wrapper.
The Academy mounts it at `/webinars/:slug/room` (`ACADEMY_ROOM_PAGE`); the
doctor storefront mounts it in PR 4.4.

## Why a package of its own (gate D9)

A `mounted` route file imports only its package and its host config
(`pnpm lint:route-mount`), so the server page and the wrapper must live in a
package. `@ds/room` cannot hold them: it is `next`-free and `process.env`-free
(`packages/room/src/purity.test.ts`) and imports only the base packages, while
the page needs `next/headers` / `next/navigation`, the session builder and the
event read of `@ds/events-storefront`, `serverApiBase()` of `@ds/auth-flow` and
the shell's `HeaderUserCluster`. So `@ds/room-page` sits above `auth-flow` in
`PACKAGE_GRAPH` (`eslint.import-boundary.config.mjs`), and nothing imports it.
The copy, the formatters and the route-table builder stay in `@ds/room`
(`./copy`, `./route-table`).

## Layout

| Subpath         | Contract                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | the `RoomPageHostConfig` type                                                                                                                                                    |
| `./page`        | `RoomPage({ config, params })` — the server page: entry resolution over the shared reads (`serverApiBase()`, D4), the refusal redirects / not-found, the event read, the wrapper |
| `./host-config` | `RoomPageHostConfig` — data only: the route values (`routes`), the brand-home label (`copy`), the public event read (`eventRead`)                                                |

`src/ui/room-client.tsx` is the `"use client"` wrapper (the EARS-14 JIT name
prompt, then `RoomShell` with the RU formatters, `next/link` and the shell
`HeaderUserCluster`); it is reached only through `./page`.

A host route file renders `<RoomPage config={…} params={params} />` and declares
`dynamic = "force-dynamic"` itself.

## Tests

`pnpm --filter @ds/room-page test` — vitest, co-located `src/**/*.test.ts{,x}`
(the server page suite runs in the node environment, the wrapper in jsdom).
