---
title: "004 — Public event page & upcoming-broadcasts listing (net-new webinar discovery)"
description: "Requirements: the publicly-readable webinar event page (pre-live, live, ended, archived-notice states) plus a minimal upcoming-broadcasts listing in the portal app. Read-side of the Webinars epic wave 1 — public SSR event page, day-grouped nearest-first listing, single «Участвовать» CTA handing off to registration (005) through auth (003), lifecycle reflected from the single event state machine. Backend read model + public query endpoints owned here; event authoring / lifecycle transitions owned by 007."
slug: 004-event-page-listing
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/7
parent_issue: https://github.com/doctor-school/ds-platform/issues/471
issues: [549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559]
prior_decisions:
  - ADR-0014 — Product-design delivery lifecycle (§2 PRD → EARS `realizes:` trace; §3/§4 canvas is source, repo holds the built artifact)
  - ADR-0002 — Backend Core Stack (§3 nestjs-zod + URI versioning `/v1/...` + Vitest; `packages/schemas/` SSOT)
  - ADR-0003 — Data Layer (event read model in Postgres + Drizzle; publish-safe projection)
  - ADR-0004 — Frontend Stack (§ portal = Next.js 15; server-rendered public surfaces; admin is Refine, out of scope here)
  - ADR-0013 — Design token SoT (build from `@ds/design-system` tokens; vendored neo-brutalist canvas is the fidelity spec)
  - ADR-0001 — Identity / Auth / RBAC (§2 endpoint-authz matrix — the public-endpoint classification for the read surface)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS)
lang: en
---

> **EN (this)** · **RU:** [`004-requirements-ru.md`](./004-requirements-ru.md)

# 004 — Public event page & upcoming-broadcasts listing (Requirements)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical». PRD source: [`004-product.md`](./004-product.md) (US-1…US-6). Mockup source of truth: the vendored canvases in [`design-source/`](../../../../../../design-source/README.md) — `webinar-page.dc.html`, `webinars-listing.dc.html`, `webinar-card.dc.html`.

## Outcomes

- A doctor who opens a **sponsor-distributed direct link** lands on a complete, server-rendered webinar event page **without authentication** — no soft wall, no gated sections — and that link is stable and renders identically for a guest and a logged-in principal (US-1, US-5).
- The event page carries everything a doctor needs to decide to attend in under a minute: title, school/series, start date + time explicitly **МСК**, description, speakers, a downloadable **program PDF**, target specialties, and the backing partners (US-2).
- The page offers **one** primary CTA «Участвовать» that leads into registration (feature 005), passing the event context; a guest passes through auth (feature 003) without losing that context (US-3).
- A minimal **upcoming-broadcasts listing** in the `portal` app shows published events whose air date is in the future, **nearest first**, each card carrying enough to choose and linking to its event page (US-4).
- The page and the listing **truthfully reflect the event's lifecycle** — upcoming / live / ended — from the **single event state machine** (`draft → published → live → ended → archived`), never a stale or contradictory signal; draft and archived events are absent from public surfaces, and a previously-distributed link to an **archived** event renders a public "event is archived" notice with **no** dead CTA (US-6).
- The read surface is built from `@ds/design-system` tokens to the vendored canvas geometry (neo-brutalist language), verified at both breakpoints × both themes (ADR-0013).

## Scope

**In:**

- **Public event page** (`portal`, server-rendered) for an event in `published` / `live` / `ended` state — publicly readable, no auth, the full content set of US-2, built to `webinar-page.dc.html`.
- **Lifecycle rendering** on the page — the `status` swap `upcoming | live | ended` (hero badge, time plate, CTA pair, footer CTA), matching the canvas `status` prop enum.
- **Archived-event direct-link handling** — a public «мероприятие в архиве» notice with no participation CTA (owner decision, variant «а»).
- **Single «Участвовать» CTA** on the page → routes into the registration flow, handing off the event context (the registration mechanics + guest→auth handoff are owned by 005/003 — see Out).
- **Upcoming-broadcasts listing** (`portal`) — published ∧ air-date-future events, ordered nearest air date first, **day-grouped** per the §09 rhythm, built to `webinars-listing.dc.html` (the day-grouped card list) rendering the `webinar-card.dc.html` unit; includes the canvas **empty-state**.
- **Public read model + query endpoints** in `apps/api` — a publish-safe `PublicEventPage` projection and an `UpcomingBroadcastCard` list projection, both classified **public** in the endpoint-authz matrix (ADR-0001).
- **Canonical Moscow-time presentation** — the read model stores a canonical instant; every surface presents it in `Europe/Moscow` explicitly labeled **МСК**.
- **RU-only copy from a typed message catalog** — no hardcoded user-facing strings, reusing the i18n-ready structure established in 003 (EARS-21).
- **Seed/fixture events** sufficient to render and E2E-drive the two surfaces before feature 007 lands admin authoring (a tracked seam — see Dependencies).

**Explicitly out** (each a named deferral, not a silent default):

- **Event authoring & lifecycle transitions** — create/edit an event, configure the stream, and drive `draft → published → live → ended → archived` are owned by **feature 007** (admin/Refine). 004 consumes the resulting state read-only and is verified against seeded events until 007 lands (Dependencies).
- **Registration mechanics** — one-tap logged-in registration, guest→auth→complete, «мои события» visibility, and the registration state shown on the event page are owned by **feature 005**. 004 owns only the CTA and the context handoff.
- **The webinar room** (embed player, live chat, heartbeat presence) behind the live join path — **feature 006**. 004's live-state CTA routes toward it; the room itself and its server-side gating are 006.
- **Calendar / month view, specialty facets, the «Только с НМО» filter, week-paging, and free-text search** — wave 2. The vendored `webinars-listing.dc.html` and `webinars-month.dc.html` show these controls; wave 1 ships only the minimal day-grouped nearest-first list without them. (`webinars-month.dc.html` is not built in 004.)
- **Recordings archive, reviews, speaker ratings, report photos/videos** — wave 2+.
- **Congresses, offline events, paid tiers** — out of the epic.

## Constraints

- **Public readability is server-side, not a client soft-wall.** The event page for `published` / `live` / `ended` is rendered server-side and fully readable with zero authentication; only the **room** behind the join path is server-side gated (feature 006). A legacy-style anonymous "авторизуйтесь для просмотра" overlay is a banned pattern (recon §7a, §8).
- **Single state machine.** Public visibility and the rendered status derive from one `EventLifecycleState` enum (`draft → published → live → ended → archived`) — never a scatter of booleans (recon §7d). Both the page and the card read the same state; they cannot disagree.
- **No hardcoded origin / URL.** The event's public URL, the portal origin, and API endpoints are read from configuration, never hardcoded in code or spec (AGENTS.md §9).
- **Canonical timezone.** Times are stored as a canonical instant and presented in `Europe/Moscow` labeled **МСК**; the presentation must not drift to the viewer's local timezone (recon §7d — the legacy "always Moscow, no TZ" gap is closed by making МСК explicit, not implicit).
- **Canvas is the fidelity spec (ADR-0013 / ADR-0014 §4).** The event page and the card are built from `@ds/design-system` tokens to the vendored `.dc.html` geometry (2px borders, `6px 6px 0` shadow, time plate, `196px 1fr` desktop grid, flat full-bleed ≤900px). Arbitrary Tailwind values are lint-blocked; where prose and the canvas disagree, the canvas wins.
- **Stack** (ADR-0002 / ADR-0004): the query endpoints are NestJS + `nestjs-zod`, schema SSOT in `packages/schemas/`, URI versioning `/v1/...`, Vitest + supertest; the portal is Next.js 15 with server-rendered public routes. Service-dependent tests `skipIf` their dependency env is absent so they do not redden the shared CI unit job.
- **Publish-safe projection.** The public read model exposes only publish-safe event fields — no operator notes, no sponsor-commercial terms, no registrant PII (recon §6 — the legacy `getEmailsForOrder` roster is never on a public surface).

## Prior decisions

- **ADR-0014** Product-design delivery lifecycle — the PRD (`004-product.md`, US-1…US-6) is the **source** of this triplet; every EARS carries `realizes: US-N` (§2). The vendored canvas is _source_, the repo holds the _built artifact_ verified against it (§3/§4).
- **ADR-0002 §3** Backend Core Stack — `nestjs-zod`, URI versioning `/v1/...`, Vitest + supertest, `packages/schemas/` SSOT for the public query DTOs.
- **ADR-0003** Data Layer — the event read model + publish-safe projection live in Postgres via Drizzle.
- **ADR-0004** Frontend Stack — the portal is Next.js 15; the public event page and listing are server-rendered portal routes. Admin (event authoring, 007) is Refine — out of scope here.
- **ADR-0013** Design token SoT — the neo-brutalist visual language ships as `@ds/design-system` tokens/components; 004 builds the page + card from tokens to the vendored canvas fidelity.
- **ADR-0001 §2** Identity / Auth / RBAC — the endpoint-authorization matrix; 004's read endpoints are the first **public** (unauthenticated) classified endpoints in the webinar domain.
- **ADR-0006 §4** Documentation & SSOT — feature-spec triplet structure + flat EARS numbering.

## Event Model

Feature 004 is the **read side** of the webinar aggregate. Event creation and lifecycle transitions are commands owned by **feature 007**; 004 owns the public **queries**, the publish-safe **read models**, and the **visibility policy** over the single lifecycle state. It emits no lifecycle events — it reads the state they leave behind.

### Queries (handled by `apps/api`, both classified **public** — no auth)

`GetPublicEventPage(idOrSlug)` · `ListUpcomingBroadcasts()`

### Events (consumed read-only; owned by feature 007's transitions)

| Event            | Owner (007) | What 004 reads                                                                   |
| ---------------- | ----------- | -------------------------------------------------------------------------------- |
| `EventPublished` | 007         | The event becomes publicly reachable and eligible for the upcoming listing.      |
| `EventWentLive`  | 007         | The page + card render the "live now" signal; the CTA routes toward the room.    |
| `EventEnded`     | 007         | The page renders the "ended" state; the card drops from the upcoming listing.    |
| `EventArchived`  | 007         | The event leaves all public listings; a direct link renders the archived notice. |

### Read models

- **`PublicEventPage`** — the publish-safe projection of one event: `id`, `slug`, `title`, `school` (series), `startsAt` (canonical instant), `durationMin`, `description`, `speakers[]` (name + credentials, no contact PII), `programPdfUrl?`, `specialties[]`, `partners[]`, `state` (`published | live | ended | archived`). Draft events have no public projection.
- **`UpcomingBroadcastCard`** — the listing card projection: `id`, `slug`, `title`, `school`, `startsAt`, `specialties[]`, `speakers[]` (names), `state` (`published | live`). Ordered by `startsAt` ascending.
- **`EventLifecycleState`** — the single enum `draft | published | live | ended | archived` that both surfaces read.

### Policies

- **Public event-page visibility** — `published`, `live`, and `ended` render the full public page; `draft` is **not publicly reachable** (not-found); `archived` renders the **archived notice** (no CTA). The page stays open through `live` and `ended`; only the room join path is gated (006).
- **Upcoming-listing membership** — a card appears **iff** the event is `published` (or `live`) **and** its air date is in the future / currently airing; `draft`, `ended`, and `archived` never appear.
- **Cross-surface consistency** — the card and the page derive `state` from the same `EventLifecycleState`; a live event reads "live" on both, so the two surfaces cannot present a contradictory signal.

## EARS requirements

> **Numbering convention:** flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4. EARS-1…9 are the functional handlers (each becomes a child Issue); EARS-10…14 are cross-cutting ubiquitous / unwanted-behavior requirements enforced across the read surface. Each clause carries a `realizes: US-N` backlink to the PRD story it formalizes (ADR-0014 §2).

**Public event page**

- **EARS-1** _(realizes: US-1, US-5)_ — When a visitor requests a `published`, `live`, or `ended` event by its stable public URL, the system shall render the full event page **server-side without requiring authentication**, returning byte-for-byte the same public content for a guest and for a logged-in principal (the sponsor's distributed link "just works" for any recipient).
- **EARS-2** _(realizes: US-2)_ — The event page shall present the complete decision set sourced from the `PublicEventPage` read model — title, school/series kicker, **start date and start time explicitly labeled МСК**, description, speakers (name + credentials), target specialty chips, backing partners, and, when the event carries one, a downloadable **program PDF** link — laid out to `webinar-page.dc.html`.
- **EARS-3** _(realizes: US-3)_ — The event page shall present exactly **one** primary CTA «Участвовать» that routes the visitor into the registration flow (feature 005) carrying the event context; a guest is taken through auth (feature 003) and returns to complete registration **without losing** that context. (004 owns the CTA and the context handoff only; the registration mechanics and the auth round-trip are owned by 005/003.)
- **EARS-4** _(realizes: US-6)_ — The event page shall reflect the event's current lifecycle state from the single `EventLifecycleState` — **upcoming** (register CTA), **live** (a "live now" signal + a CTA routing toward the room, feature 006), or **ended** (a "recording/ended" state with **no dead CTA**) — swapping the hero badge, the time plate, and the CTA affordance per the canvas `status` enum, and never showing a signal that contradicts the machine.

**Visibility & archived links**

- **EARS-5** _(realizes: US-6, US-5)_ — When a visitor requests the page of an **archived** event via a previously-distributed direct link, the system shall render a **public "мероприятие в архиве" notice with no participation CTA** (owner decision, variant «а») — never a `404`, a redirect to the listing, or a live CTA. (Resolves the PRD open question on archived-link behaviour; a distributed link degrades gracefully instead of dead-ending.)
- **EARS-6** _(realizes: US-6)_ — A **draft** event shall not be publicly reachable — a request for a draft's page returns not-found (indistinguishable from a non-existent event), and no draft ever appears on a public listing. Only `published` / `live` / `ended` are publicly rendered; `archived` is the EARS-5 notice.

**Upcoming-broadcasts listing**

- **EARS-7** _(realizes: US-4)_ — The portal shall present an **upcoming-broadcasts listing** of events that are `published` or `live` and whose air date is in the future or currently airing, ordered **nearest air date first**, day-grouped per the §09 rhythm and built to `webinars-listing.dc.html` (wave 1 ships the minimal list — **no** specialty facets, week-paging, month view, or search).
- **EARS-8** _(realizes: US-4)_ — Each listing card shall carry the choose-set from the `UpcomingBroadcastCard` projection — **start date + time (МСК)**, title, school/series, target specialties, and speakers — rendered as the `webinar-card.dc.html` unit, and shall link to that event's page (EARS-1).
- **EARS-9** _(realizes: US-6, US-4)_ — When an event is **live**, both its listing card and its event page shall show the "live now" signal derived from the same `EventLifecycleState`, so a doctor never sees a contradictory state across the two surfaces; a card whose event has `ended` or been `archived` shall drop from the listing on the next read.

**Cross-cutting (ubiquitous / unwanted-behavior)**

- **EARS-10** _(realizes: US-1, US-5)_ — The `GetPublicEventPage` and `ListUpcomingBroadcasts` endpoints shall be classified **public** in the endpoint-authz matrix (ADR-0001 §2), require **no** authentication, and expose **only** the publish-safe projection — never a `draft`/`archived`-as-active event body, operator/commercial fields, or registrant PII.
- **EARS-11** _(realizes: US-4)_ — When no `published`/`live` future-dated event exists, the listing shall render the canvas **empty-state** (a clear "no upcoming broadcasts" affordance) rather than a blank or broken surface.
- **EARS-12** _(realizes: US-2, US-6)_ — Every date/time on both surfaces shall be presented in **`Europe/Moscow`, explicitly labeled МСК**, computed from the read model's canonical instant, and shall not drift to the viewer's local timezone.
- **EARS-13** _(realizes: US-1, US-2, US-3, US-4)_ — The portal webinar surfaces shall render in **Russian** with **no hardcoded user-facing strings** — all copy (labels, status badges, CTA text, the archived-notice copy, the empty-state copy) sourced from the typed message catalog established in 003 (EARS-21), over the i18n-ready structure, so a later locale can be added without re-touching components.
- **EARS-14** _(realizes: US-1, US-2, US-4)_ — The event page and the listing card shall be built from **`@ds/design-system` tokens** to the vendored canvas geometry (`webinar-page.dc.html`, `webinar-card.dc.html`, `webinars-listing.dc.html`) — 2px borders, `6px 6px 0` shadow, `196px 1fr` desktop grid, flat full-bleed ≤900px, time plate — rendering correctly at **both breakpoints × both themes**; arbitrary Tailwind values are lint-blocked (ADR-0013).

## Invariants

- No non-public event is ever exposed on a public surface: a `draft` page is not-found, an `archived` page is the EARS-5 notice, and neither `draft` nor `ended` nor `archived` appears in the upcoming listing (EARS-6, EARS-7, EARS-10).
- The public event page and the listing card derive their rendered lifecycle state from the **same** `EventLifecycleState`; the two surfaces can never present a contradictory state for one event (EARS-9).
- The public read model and endpoints expose only publish-safe fields — no operator/commercial data and no registrant PII (EARS-10).
- Every date/time rendered on either surface is in `Europe/Moscow` labeled МСК, derived from one canonical instant (EARS-12).
- The public event page is fully readable with zero authentication in `published` / `live` / `ended`; the guest and authenticated renders are content-identical (EARS-1). Only the room join path is gated (feature 006), never the page.
- The event page carries exactly one primary participation CTA; in the `ended` state that CTA is absent, never a dead link (EARS-3, EARS-4).

## Verification

| EARS | Test type                     | File (indicative)                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Vitest e2e                    | `apps/api/test/events/public-event.e2e-spec.ts`                    | `it('EARS-1: ...')` published/live/ended event fetched with no auth header returns the full projection; guest and authenticated requests return identical public bodies. `skipIf(!DATABASE_URL)`.                                                                                                                                                                                                                            |
| 2    | Vitest e2e + unit             | `apps/api/test/events/public-event.e2e-spec.ts`                    | Projection carries title, school, `startsAt`, description, speakers (no PII), specialties, partners, `programPdfUrl?`; the PDF field is optional and omitted (not null-broken) when the event has none.                                                                                                                                                                                                                      |
| 3    | Playwright (browser)          | `apps/portal/e2e/event-page.spec.ts`                               | The upcoming page renders exactly one primary «Участвовать» CTA; clicking it (as a guest) enters the registration/auth handoff carrying the event context. The 005/003 handoff target is stubbed in 004's E2E (the real flow is 005).                                                                                                                                                                                        |
| 4    | Playwright (browser) + unit   | `apps/portal/e2e/event-page.spec.ts`                               | Drives the three lifecycle renders — upcoming (register CTA), live ("live now" + room-routing CTA), ended (no dead CTA); asserts the hero badge / time plate / CTA swap matches the canvas `status` enum.                                                                                                                                                                                                                    |
| 5    | Vitest e2e + Playwright       | `apps/api/test/events/archived.e2e-spec.ts` + `event-page.spec.ts` | An archived event's direct link returns the public "в архиве" notice body (not 404 / not a redirect) and the rendered page shows the notice with no participation CTA.                                                                                                                                                                                                                                                       |
| 6    | Vitest e2e                    | `apps/api/test/events/visibility.e2e-spec.ts`                      | A draft event's public URL is not-found (indistinguishable from a non-existent id); draft/ended/archived never appear in the listing projection.                                                                                                                                                                                                                                                                             |
| 7    | Vitest e2e                    | `apps/api/test/events/listing.e2e-spec.ts`                         | `ListUpcomingBroadcasts` returns only published/live future-dated events, ordered nearest `startsAt` first; past/draft/archived excluded.                                                                                                                                                                                                                                                                                    |
| 8    | Playwright (browser)          | `apps/portal/e2e/listing.spec.ts`                                  | Each card shows date+time (МСК), title, school, specialties, speakers, and navigates to the correct event page on click.                                                                                                                                                                                                                                                                                                     |
| 9    | Vitest e2e + Playwright       | `apps/portal/e2e/listing.spec.ts`                                  | A seeded live event reads "live now" on both the card and the page (single-state consistency); an ended/archived event drops from the listing on re-read.                                                                                                                                                                                                                                                                    |
| 10   | Vitest e2e + unit             | `apps/api/test/events/authz.e2e-spec.ts`                           | Both read endpoints are reachable with no auth and carry the endpoint-authz **public** classification; the projection contains no operator/commercial field and no registrant PII; a draft/archived body is never returned as an active event.                                                                                                                                                                               |
| 11   | Playwright (browser)          | `apps/portal/e2e/listing.spec.ts`                                  | With no upcoming published event seeded, the listing renders the empty-state affordance, not a blank surface.                                                                                                                                                                                                                                                                                                                |
| 12   | Vitest unit + Playwright      | `apps/portal/e2e/*.spec.ts`                                        | Times render in `Europe/Moscow` labeled МСК regardless of the test browser's timezone (Playwright `timezoneId` override asserts no local drift).                                                                                                                                                                                                                                                                             |
| 13   | ESLint (no-hardcoded-strings) | `apps/portal` lint                                                 | No hardcoded user-facing string in the webinar surfaces; copy resolves through the message catalog (mirrors the 003 EARS-21 gate).                                                                                                                                                                                                                                                                                           |
| 14   | Playwright (browser, visual)  | `apps/portal/e2e/fidelity.spec.ts`                                 | The event page + card render to the vendored canvas geometry at both breakpoints (desktop `196px 1fr`, mobile ≤900 flat full-bleed) × both themes (light/dark); no arbitrary Tailwind value (token-lint green).                                                                                                                                                                                                              |
| all  | Playwright BDD (e2e→browser)  | `004-scenarios.feature`                                            | Happy path + failure branches translated to Playwright via `playwright-bdd`. **This is a `user-facing` spec, so an end-to-end browser run (open direct link → read page → open listing → click card → back to page, across upcoming/live/ended/archived states) is a required deliverable — owned and tracked by the 004 portal-integration + E2E child Issue (opened by `open-ears-issues` step 3a), not a bare footnote.** |

## Dependencies & sequencing

- **Event read model + seed (tracked seam → feature 007).** 004 owns the `PublicEventPage` / `UpcomingBroadcastCard` read model and the two public query endpoints, but **event authoring and the `draft → published → live → ended → archived` transitions are owned by feature 007** (admin/Refine). Until 007 lands, 004 is built and E2E-driven against **seeded fixture events** covering each lifecycle state. This is a tracked seam, not a silent stub: the "done against the real dependency" criterion is _"the 004 surfaces render events authored and transitioned through 007, not only seed fixtures"_, carried on the 004↔007 blocking link that `open-ears-issues` wires (its step 4).
- **Registration/auth handoff (feature 005 / 003).** EARS-3's «Участвовать» hands the event context to the registration flow. Auth (003) is already shipped; the registration mechanics (005) are a **later vertical**. 004's E2E stubs the handoff target and asserts only that the CTA enters the flow with the event context intact — the completed registration is verified in 005.
- **Webinar room (feature 006).** EARS-4/EARS-9's live-state CTA routes _toward_ the room; the room and its server-side join gating are 006. 004 asserts the routing target, not the room.
- **Design system (`@ds/design-system`, ADR-0013).** The neo-brutalist tokens/primitives the page and card build on ship from the DS foundation (#510 → #512–515, on `main`). The webinar-card unit (`webinar-card.dc.html`) is already vendored (pulled early for the #514 rhythm demo). No new DS primitive is expected to be graduated by 004; any bespoke element the canvas needs beyond the DS inventory runs the `build-ui-from-design-system` registry gate first and is recorded in the PR.
- **Dev-stand Postgres.** The read-model e2e tests run against the dev-stand Postgres (`DATABASE_URL` from `.env.local`); the portal E2E runs against the live stand per `.claude/rules/dev-stand.md`.
