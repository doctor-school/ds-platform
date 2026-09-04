# `@ds/room` — the shared webinar-room unit

The ONE canonical implementation of the live webinar room (feature 006), hosted by
both storefronts: the Academy (`apps/portal`, `/webinars/[slug]/room`) and the
doctor storefront (`apps/doctor`, `/events/[slug]/room`). Cross-front capability
reuse is a hard rule (AGENTS.md §6, ADR-0013 A1) — an app-to-app import or a second
room composition is a defect, not an optimisation. Registry row: «Live room UI
(composition)» in `apps/docs/content/specs/product/two-site-ia/capability-ownership.md`.

## Layering

One direction of dependency, `ui → client → model`; nothing points back.

| Stratum         | Holds                                                | May import            |
| --------------- | ---------------------------------------------------- | --------------------- |
| `src/model/**`  | pure functions and state machines — no I/O, no React | `@ds/schemas` only    |
| `src/client/**` | `"use client"` hooks and the browser transport       | `src/model/**`, React |
| `src/server/**` | parameterised server reads, JSX-free                 | `src/model/**`        |
| `src/ui/**`     | composition over `@ds/design-system` primitives      | everything above      |

## Host-free by construction

The package imports no host and no framework catalogue: no `next`, no `next/*`, no
`next-intl`, nothing from `apps/portal` or `apps/doctor` — not even as a type
import. `apps/doctor` carries no `next-intl` and no messages catalogue, so every
string and every route is INJECTED by the host (the `copy`, `routes`,
`linkComponent`, `userCluster` and callback seams). `src/purity.test.ts` enforces
this on every push; the host-side rewrite-parity assertions deliberately live in
each app (`apps/portal/lib/next-config-rewrite.test.ts` and its doctor twin), never
here.

## Where the pixels live

Off-scale room geometry lands in `packages/design-system/src/primitives/webinar-room.tsx`, never here — `packages/room` is inside the `no-arbitrary-tailwind-value` gate (the exemption is the DS layer only).

`@ds/room` owns the ENGINE (state machines, transport, entry resolution,
composition); `@ds/design-system` owns the PIXELS. A room layout that needs an
arbitrary Tailwind value belongs in the DS primitive, which is the single layer
exempt from that gate.

## Exports

| Subpath          | Contract                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`              | client barrel — the room parts, hooks and types                                                                                                                     |
| `./server`       | JSX-free server reads and entry resolution                                                                                                                          |
| `./embed`        | the pure `resolveEmbed` provider→embed-URL resolver (also feeds the 014 recording player)                                                                           |
| `./display-name` | `setDisplayName`, `DisplayNameError`, `initialsFromDisplayName` — no room UI, so a non-room route importing it never pulls the chat transport into its module graph |

## Tests

`pnpm --filter @ds/room test` — vitest, jsdom, co-located `src/**/*.test.ts{,x}`.
Test titles open with `006 EARS-N:` (or `006:` for a non-EARS invariant) per
ADR-0006 §4 and the `ears-naming` guard.
