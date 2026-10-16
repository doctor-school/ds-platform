# `@ds/event-page` — the one event page

The ONE canonical event page (feature 020, epic #2020 wave 3, #2072), mounted by
the storefronts from their event route with a data-only host config.
Cross-front capability reuse is a hard rule (AGENTS.md §6, ADR-0013 A1) — a
second event-page composition in a host is a defect. Registry row: «Event page
composition blocks» in
`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`. Gate:
`apps/docs/content/specs/tech/2026-10-16-event-page-wave-3-entry-gate-en.md`.

Since wave-3 PR 3.1 the package holds the Academy composition moved unchanged
from `apps/portal/app/webinars/[slug]/page.tsx`: the event read, the
server-resolved participation card with the one-tap slot, the hero status plate
with the recording badge, the room access-branch guidance (`?from=room`), the
recording plaque / guest gate / player / raw-original spoiler, the about and
programme sections, the speakers, the format block and the partners plate. The
Academy mounts it at `/webinars/[slug]`; the doctor storefront mounts it in PR
3.2.

## Why a package of its own (gate D1)

The page composes the recording player, which needs `@ds/room/embed`, and
`@ds/events-storefront` may not import `@ds/room`. The page also may not import
`@ds/auth-flow`. So `@ds/event-page` sits beside `@ds/auth-flow` in
`PACKAGE_GRAPH` (`eslint.import-boundary.config.mjs`): it imports
`@ds/schemas`, `@ds/design-system`, `@ds/room` and `@ds/events-storefront`.

## Layout

| Path              | Holds                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/ui/**`       | `EventPage` (server component) and the recording units: `RecordingGate` (server) and `RecordingPlayer` (`"use client"`) |
| `src/server/**`   | `fetchEventPlayback` — the authenticated 014 source read (`/v1/events/:slug/recordings`), `no-store`, never for a guest |
| `src/copy/**`     | `EVENT_PAGE_COPY` — every fixed sentence of the page, the Academy's catalogue sentences moved verbatim (gate D7)        |
| `src/host-config` | `EventPageHostConfig` — the data a host states (gate §4.4)                                                              |

The event and participation reads are `@ds/events-storefront/server`
(`fetchPublicEventPage`, `fetchParticipationCta`, `fetchEventRegistrationState`,
`forwardedSessionFrom`); the page addresses them at the host's
`contentSet.pagePath`. The recording gate's return carry is `@ds/schemas`
`withReturnTarget` (gate D3).

## Exports

| Subpath         | Contract                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | `EventPageHostConfig` (type), `EVENT_PAGE_COPY`                                                                                                                                                          |
| `./page`        | `EventPage({ config, params, searchParams })` — the route mount: a host route file renders it with its host config and the route props and nothing else, and declares `dynamic = "force-dynamic"` itself |
| `./host-config` | `EventPageHostConfig` — `contentSet.pagePath` (+ optional `relayCookie`), `routes.{listing,eventPage,login,register}`, `copy.breadcrumb`; data only, the closed adapter list is empty (gate §4.5)        |

## Host wiring

A mounting host lists `@ds/event-page` in `next.config` `transpilePackages`
and `@source`s `packages/event-page/src` in its `globals.css` — undeclared, the
page's utilities are purged in the Docker build. The package ships no runtime
files, so it needs no `outputFileTracingIncludes` entry.

## Tests

`pnpm -F @ds/event-page test` (Vitest, jsdom). The page render is covered by
the Academy e2e (`apps/portal/e2e/{event-page.e2e,event-page-020.e2e,event-page-registered,event-page-parity.e2e,webinar-archive,return-to-origin,room-access-branches}.spec.ts`).
