---
title: "014 — Event recordings and the archived-event page"
description: "Requirements for retained event_recordings with kinds edited and raw, their own publication status scheme, the data-driven edited-over-raw display rule, the publicly readable post-live state of /webinars/[slug] with a login-gated player and an operator-dated «запись готовится» plaque, the platform-wide post-login return-to-origin rule, past registered events and recordings in «Мои события», and the reusable event card/list/pagination unit carrying the «Прошедшие» tab plus project, expert and topic facets."
slug: 014-event-recordings
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
issues: []
prior_decisions:
  - ADR-0014 — Product-design delivery lifecycle (§2 PRD → EARS `realizes:` trace; Stage A precedes user-facing implementation; the canvas is the composition source of truth)
  - "ADR-0001 — Identity / Auth / RBAC (recording playback: `access: authenticated`; operator attach/publish: `platform_admin` on the dedicated admin session; announcement reads: `access: public`)"
  - ADR-0002 — Backend Core Stack (NestJS + nestjs-zod; REST/OpenAPI under `/v1`; public cursor pagination, admin offset pagination; RFC 7807; idempotency)
  - ADR-0003 — Data Layer (§4 retained-row lifecycle; Postgres + Drizzle; restrictive foreign keys; no physical delete or cascade)
  - ADR-0004 — Frontend Stack (§3 Next.js portal for the doctor-facing surface; the existing Refine `apps/admin` for operator authoring)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS numbering)
  - ADR-0013 — Design-token SoT and design-system-first adoption gate
lang: en
---

> **EN (this)** · **RU:** [`014-requirements-ru.md`](./014-requirements-ru.md)
>
> PRD source: [`014-product.md`](./014-product.md) (US-1…US-16). Epic: [Academy public surface](../../product/academy-public/brief.md). Feature 014 ships doctor-facing portal surfaces and an operator authoring surface, so `surface: user-facing`. Delivers the outcome of [#1188](https://github.com/doctor-school/ds-platform/issues/1188) / Plane DSP-229.

# 014 — Event recordings and the archived-event page (Requirements)

## Delivery waves

Every EARS clause below is tagged **`wave: core`** or **`wave: facets`**. The split exists so 014 runs in parallel with the 012 implementation:

- **`core`** — no dependency on feature 012. Recording records and lifecycle, the operator attach/publish surface, the post-live event-page state, the login gate and the return-to-origin rule, «Мои события», the reusable event card/list/pagination unit, and the `/webinars` «Предстоящие | Прошедшие» tabs.
- **`facets`** — reads 012's public taxonomy API (`projects`, `experts`, `topics` and their event joins). Its child Issues are wired `blocked_by` the 012 relations wave; nothing in `core` waits on them.

`open-ears-issues` reads these tags to build the two waves.

## Outcomes

- A finished broadcast keeps its value: the event page gains a post-live state with a player instead of becoming a stale announcement.
- A recording is a first-class retained record with an explicit kind — `edited` or `raw` — and its own publication status, never a video URL column on the event.
- The edited-over-raw display rule is computed from the data at read time; publishing the edited cut later changes the page with no operator page edit.
- A visitor without an account reads a past event's page in full; only playback requires an account, and the sign-in path returns the visitor to the page they came from.
- A finished event with no published recording states an honest, operator-dated «запись готовится» plaque instead of an empty player, and the plaque clears itself the moment a recording is published.
- A registered doctor finds their whole registration history in «Мои события» — including past events whose recording is not ready — each entry one click from its recording.
- `/webinars` becomes a browsable archive: «Предстоящие | Прошедшие» tabs plus project, expert and topic facets, both delivered inside the reusable event card/list/pagination unit that 015, 016 and «Мои события» consume afterwards.

## Scope

**In:**

- Retained `event_recordings`: stable id, `event_id`, `kind: edited | raw`, playable source reference and provider, optional poster reference, optional duration, `status: draft | published | retired`, nullable `deleted_at`, nullable set-once `first_published_at`, monotonic `version`, timestamps. At most one non-retired recording per `(event_id, kind)`.
- A recording's **own status scheme**, independent of attaching it: `AttachRecording` creates a `draft`; `PublishRecording` / `UnpublishRecording` / `RetireRecording` / `RestoreRecording` move it. Attaching never publishes.
- One new nullable `events.recording_expected_by` column: the per-event readiness date the operator sets, and the only source of the «запись готовится» timeframe.
- Refine authoring on the existing feature-007 event detail: a recordings panel (attach, edit source, publish, unpublish, retire, restore) plus the readiness-date field. No Delete action exists.
- Public post-live reads of `/v1/public/events/:idOrSlug`: the announcement projection stays public and complete; a `recording` projection reports presence, kind, poster and the readiness date — **never a playable source**.
- An authenticated playback read that returns the playable source for the recording the display rule selects, plus the secondary raw source when both kinds are published.
- Portal `/webinars/[slug]` post-live state built from `design-source/webinar-archive.dc.html`: `viewer: authed | guest`, `recording: montage | raw-only | preparing`, `secondaryUi: spoiler`.
- The platform-wide post-login return-to-origin rule, realized for 014's login-gated surfaces.
- Portal `/account/events` («Мои события») with the canvas tabs «Предстоящие | Записи», full registration history newest-first inside each tab, rendered by the shared list unit.
- The reusable **event card + list + pagination unit** in `@ds/design-system` / the portal (epic decision #7) — **owned and built by 014**, because 014 starts before the 013 build.
- `/webinars` «Предстоящие · N | Прошедшие · N» tabs, past events newest-first, delivered inside that unit.
- **(`facets`)** The controlled facet unit from `design-source/events-filter.dc.html` — Проект / Эксперт / Тема, searchable single-select dropdowns with per-option counts — plus the server-side filtering that backs it, reading 012's public taxonomy API.
- Mobile parity and the `playwright-axe` accessibility bar on every new surface.

**Out:**

- Redesigning the live/pre-live event page or the `/webinars` listing composition (PRD → Out of scope; design brief sections 4–5).
- The video hosting, upload and transcoding decision. 014 requires a playable source reference behind the existing provider abstraction; where bytes live is a separate technical decision.
- Attendance-gated access. The gate is authentication only: any account may watch any published recording.
- Download, offline viewing and playback-position resume.
- Watch analytics, partner reporting, and «your recording is ready» notifications.
- New materials/slides upload surfaces; existing event materials keep rendering unchanged.
- The «Сертификаты» tab drawn on `design-source/my-events.dc.html`. Owner decision 2026-08-17: it is a canvas review miss, not a future seam — 014 renders **two** tabs. No seam, no flag, no placeholder ships; the note is recorded in `design-source/README.md`.
- Re-modelling speakers, projects or topics. 014 reads the 012 taxonomy; 012 owns it.
- Carrying the return-to-origin rule into other specs. 014 states the rule and realizes it for its own surfaces; the inline rewrite of 013 ([#1324](https://github.com/doctor-school/ds-platform/issues/1324)) and of the 003/008 auth flows is tracked outside this spec (see Related).

## Owner-recorded decisions (2026-08-17)

These are verbatim owner answers on [#1326](https://github.com/doctor-school/ds-platform/issues/1326) and approved-canvas defaults. They are decisions, not open questions; the PRD's «Open questions» section is superseded on each point.

| Point                        | Decision                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| «запись готовится» timeframe | The operator sets a per-event readiness date. Not a fixed platform-wide promise.                                                                 |
| Guest return after sign-in   | Automatic return to the originating page — **a platform-wide rule** for every login-gated content surface, not a 014-local behaviour.            |
| «Мои события» composition    | The canvas wins: tabs «Предстоящие \| Записи», default «Предстоящие». Full registration history newest-first inside each tab.                    |
| Past event with no recording | Still listed in «Мои события».                                                                                                                   |
| Recording visibility         | A recording has its own status scheme; publication is a separate act from attaching.                                                             |
| Past/upcoming control        | Tabs, mirroring the «Предстоящие · N \| Прошедшие · N» tabs already drawn on `project-page.dc.html` / `expert-page.dc.html`. No new design fork. |
| Facet logic                  | AND across facets (project ∧ expert ∧ topic). Zero-yield options stay visible and clickable, with the count simply absent.                       |
| Secondary raw recording      | Canvas `secondaryUi` default `spoiler` — a collapsible «Смотреть оригинал трансляции» under the main player.                                     |

## Constraints

- **Retained rows only.** No application path issues `DELETE`, `TRUNCATE` or `ON DELETE CASCADE` for `event_recordings`, and no id is reused. `event_recordings.event_id` is `RESTRICT`. Retiring a recording never changes the event's lifecycle state.
- **Lifecycle consistency.** `retired ⇔ deleted_at IS NOT NULL`; `draft` and `published` iff it is null. Transitions are `draft → published`, `published → draft` (unpublish), `draft|published → retired`, `retired → draft`. `first_published_at` is set once on the first publish and never cleared.
- **The gate is server-side.** A playable source reference is absent from every unauthenticated response body. Hiding the player in CSS, returning a source the client declines to render, or gating in a Next.js client component alone does not satisfy EARS-5.
- **One event page.** `/webinars/[slug]` stays the single event route for every context. The post-live state is a state of that page — no second route, no `/archive/...` mirror.
- **The display rule is derived, never stored.** No `is_primary`, `is_featured` or ordering column on `event_recordings` selects the main player; selection is `edited` first, else `raw`, over published non-retired rows only.
- **Honest emptiness.** A finished event with no published recording renders the plaque. A published recording whose source is unavailable at playback renders an explicit unavailability message with a retry affordance. Neither state may be an empty box, a spinner that never resolves, or a silently missing section.
- **No stub seam.** Schema, migration, Zod contract, generated SDK, API handler, Refine panel and portal surface ship as real vertical slices. Seeds, fake sources, placeholder cards and manual DB steps do not satisfy an EARS clause.
- **One list unit.** The tabs, pagination and facets exist once, in the shared event card/list/pagination unit. A `/webinars`-only copy is a defect; 015, 016 and «Мои события» consume the same unit.
- **Facets read 012, they do not re-model it.** No 014 table stores a project, expert or topic; facet options and counts come from 012's public taxonomy reads.
- **Bounded queries.** A listing page issues a bounded number of statements — the page query plus one facet-option query. Per-card or per-facet N+1 fan-out is refused at review.

## Prior decisions

- **ADR-0014 §2:** the PRD is the source of the EARS triplet and each clause carries a `realizes: US-N` backlink; Stage A precedes user-facing implementation and an approved canvas default is the decision, not a question to re-open.
- **ADR-0003 §4:** every application-owned entity is retained — `event_recordings` has no physical delete, no cascade and restrictive foreign keys; normal reads filter `deleted_at IS NULL`.
- **ADR-0002 §§3–4, 9:** Zod is the request/response SSOT, REST is versioned under `/v1`, public growing lists use opaque cursors, mutation errors are RFC 7807 Problem Details and mutations are idempotent.
- **ADR-0001 §§4, 7:** the three access classes this feature uses are exactly `public` (the announcement projection), `authenticated` (recording playback — no role, no registration, no attendance) and `platform_admin` on the dedicated MFA-verified admin session (attach and publish).
- **ADR-0004 §3:** the doctor-facing surface is the Next.js portal; operator authoring extends the existing Refine `apps/admin`, not a second backend and not Payload CMS.
- **ADR-0006 §4:** the feature-spec triplet and flat EARS numbering; `it('EARS-N: …')` test titles.
- **ADR-0013 + AGENTS.md §6:** implementation runs the design-system-first gate; interaction states, tokens and primitives come from `@ds/design-system`, and canvas-derived UI is built from the vendored `design-source/` files rather than from issue prose.
- **Feature 004:** owns `/webinars` and `/webinars/[slug]`. 014 adds a post-live state and a past tab to those existing surfaces; it does not create a second event route or a second listing.
- **Feature 005:** owns `registrations`, the join «Мои события» projects over. 014 adds tabs and ordering, not a second registration record.
- **Feature 006:** already abstracts a playable stream as `stream_config.provider` + `embed_ref`. 014 reuses that shape for a recording source rather than introducing a second media abstraction or deciding video hosting.
- **Feature 007:** supplies the admin event detail plus the authorization and idempotency precedent the recordings panel mirrors.
- **Feature 010:** supplies generic audit capture; `event_recordings` attaches to it, so 014 introduces no audit table of its own and no technical-table exclusion.
- **Feature 011 + ADR-0001 §§7/10:** the dedicated MFA-verified admin session and CSRF double-submit that every 014 admin mutation reuses.
- **Feature 012:** owns projects, experts and topics and their event joins. The `facets` wave reads that public API; no 014 table stores a taxonomy record.
- **Epic decision #3 (Academy public surface brief):** the archive is a registration driver — the gate is authentication, framed as free, never a paywall.
- **Epic decision #4:** `/webinars/[slug]` is the single event page for every context; the archived state is a state of that page.
- **Epic decision #6:** the edited cut takes the main player and the raw capture moves to a secondary slot.
- **Epic decision #7:** one reusable event card + list + pagination unit serves every listing surface; 014 owns and builds it because 014 starts before the 013 build.

## Lead technical decisions

- **LD-1 — recording identity and the at-most-one-per-kind rule.** `event_recordings` carries a stable UUID id; the operator-error branch in the PRD («more than one recording of the same kind») is enforced as a partial unique index `UNIQUE (event_id, kind) WHERE deleted_at IS NULL`, so a retired row frees the slot for a replacement while history is retained. A second attach of the same kind is 409 `RECORDING_KIND_OCCUPIED`, naming the retained row to edit or retire.
- **LD-2 — publication is separate from attachment.** The owner's «у записи своя статусная схема» is realized as the 012-shaped `draft | published | retired` scheme on the recording row itself, orthogonal to the event's own `eventLifecycleState`. An `ended`/`archived` event with only draft recordings still renders the plaque; a `published` recording on a still-`live` event is refused with 409 `EVENT_NOT_FINISHED`, because a post-live surface for an unfinished event is not a supported state.
- **LD-3 — the derived selection projection.** One resolver computes `RecordingProjection { state: montage | raw-only | preparing, primaryKind, secondaryKind }` from published non-retired rows: both kinds → `montage` (`primary=edited`, `secondary=raw`); raw only → `raw-only`; edited only → `montage` with no secondary; none → `preparing`. That single resolver feeds the public page projection, the authenticated playback route, the «Мои события» entries and the archive-listing badge, so no two surfaces can disagree.
- **LD-4 — two-layer read split at the gate.** `GET /v1/public/events/:idOrSlug` returns `recording: { state, primaryKind, secondaryKind, posterUrl, expectedBy }` and no source. `GET /v1/events/:idOrSlug/recordings` (`access: authenticated`) returns the playable `{ kind, provider, embedRef }` for the primary and, when present, the secondary. This keeps the announcement cacheable as a public document while the source stays behind the session, and it makes the gate testable as an HTTP fact rather than a rendering detail.
- **LD-5 — the readiness date lives on the event, not the recording.** The plaque exists precisely when no recording does, so its timeframe cannot hang off a recording row. `events.recording_expected_by` is a nullable date set by the operator on the event form; the plaque renders it, and renders a bare honest line without a date when it is unset. Publishing a recording makes the plaque unreachable without clearing the column, so a re-retired recording restores a still-correct plaque.
- **LD-6 — return-to-origin is one platform mechanism.** The rule is realized once, in the portal auth entry, as a signed same-origin `returnTo` carried through registration/login/verification and consumed on the first authenticated navigation. 014 states the rule and implements the mechanism for its own gated surface; other specs consume the same mechanism rather than re-deriving a per-page redirect. Only same-origin relative paths are accepted; anything else falls back to the surface's default landing, so the mechanism is not an open redirect.
- **LD-7 — the shared list unit is a controlled component with an injected data source.** 014 builds `EventList` (card grid + tabs + pagination) and `EventFilters` (the three facets) as controlled units — props for the selected tab, facet values, option lists with counts and page cursor, plus `onChange` callbacks — exactly the shape `events-filter.dc.html` encodes. The unit issues no fetches of its own; each consuming surface (`/webinars`, project page, expert page, «Мои события») supplies the data. That is what lets the `facets` wave land as a capability of the unit without touching the `core` surfaces that already consume it.
- **LD-8 — one bounded archive query with a companion facet-count query.** The `/webinars` listing filters by `timeframe` plus AND-composed facet ids in one paginated statement; facet option lists and counts come from one companion query per request. Zero-yield options are returned with a null count and remain selectable, per the owner's answer 7. Counts reflect the other facets' current selections; a facet's own selection does not filter its own option list.
- **LD-9 — «Мои события» tabs are a projection over the same registration history.** `GET /v1/me/events` gains `tab=upcoming|recordings` and returns the full history for the tab, newest first, over the existing `registrations` join. The «Записи» tab lists **every** past registered event — a recording-less entry carries the `preparing` badge (owner answer 4) — so the tab is the doctor's history, not a recording index.

## Event Model

### Commands

- `AttachRecording(eventId, kind, source, poster?, durationSec?)` — create one `draft` `event_recordings` row. Never publishes.
- `UpdateRecording(recordingId, fields)` — edit the source, poster or duration of the same retained row.
- `PublishRecording(recordingId)` / `UnpublishRecording(recordingId)` — `draft → published` (sets `first_published_at` once) / `published → draft`.
- `RetireRecording(recordingId)` / `RestoreRecording(recordingId)` — `→ retired` + `deleted_at` / `retired → draft`. No Delete command or route exists.
- `SetRecordingReadinessDate(eventId, expectedBy | null)` — set or clear `events.recording_expected_by`.

Every mutating recording endpoint requires a canonical UUID `Idempotency-Key` and the target ETag (`If-Match`) on non-create methods, per feature 007's precedent.

### Events

| Event                                         | Meaning                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RecordingAttached`                           | One draft recording of an explicit kind now exists for the event; nothing about the page changed yet. |
| `RecordingPublished` / `RecordingUnpublished` | The derived projection changed; the page and the archive badge follow with no operator page edit.     |
| `RecordingRetired` / `RecordingRestored`      | A retained row left or re-entered the authoring set; the kind slot freed or re-occupied.              |
| `RecordingReadinessDateSet`                   | The plaque's timeframe changed for that event.                                                        |

### Read models

- `RecordingProjection { state: montage | raw-only | preparing, primaryKind, secondaryKind, posterUrl, expectedBy }` — public, source-free.
- `PlayableRecording { kind: edited | raw, provider, embedRef, durationSec }` — authenticated only; the playback route returns `{ primary, secondary }` where `secondary` is `PlayableRecording | null`.
- `PublicEventSummary` (from feature 012 / 004) gains a nullable `recordingState` so an archive card can carry the «Запись доступна / готовится» badge without a second call.
- `ArchiveListing { data: PublicEventSummary[], pagination: { nextCursor, hasMore }, counts: { upcoming, past } }` — the tab counts the canvas renders as «Предстоящие · N | Прошедшие · N».
- `FacetOptions { projects: FacetOption[], experts: FacetOption[], topics: FacetOption[] }` where `FacetOption { id, slug, label, count: number | null }`; `count` is null for a zero-yield option, which stays selectable.
- `MyEventsListing { tab: upcoming | recordings, data: (PublicEventSummary & { registeredAt, recordingState })[], pagination }`.
- `RecordingAdminDetail` — every authoring field plus `status`, `version`, `firstPublishedAt` and `deletedAt`, for the Refine panel.

### Policies

- Public reads expose a recording only when it is `published`, non-retired, and its event is publicly readable. A `draft` or `retired` recording is indistinguishable from none: the page shows the plaque.
- Playback reads require an authenticated session and nothing else — no event registration, no role, no attendance record.
- The primary/secondary selection is recomputed on every read; no cached ordering is persisted.
- A recording cannot be published while its event is not finished (`live` or earlier).
- Facet options and counts include only published, non-retired taxonomy records with active joins, per 012's public default-deny.

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories, carries its delivery wave, and is covered by `014-scenarios.feature`.

- **EARS-1** _(realizes: US-9 · wave: core)_ — When a `platform_admin` attaches a recording to an event through the feature-007 event detail, the system shall persist one retained `event_recordings` row with stable id, monotonic version, explicit `kind: edited | raw`, a playable source reference behind the existing provider abstraction, optional poster and duration, and `status: draft`; a second attach of a kind that already has a non-retired row shall return 409 `RECORDING_KIND_OCCUPIED` naming that row, and no recording shall ever be represented as a URL column on `events`.
- **EARS-2** _(realizes: US-9, US-10 · wave: core)_ — When a `platform_admin` publishes, unpublishes, retires or restores a recording, the system shall move only that row through `draft | published | retired`, set `first_published_at` exactly once on the first publish and never clear it, keep `retired ⇔ deleted_at IS NOT NULL`, refuse a publish whose event is not finished with 409 `EVENT_NOT_FINISHED`, leave the event's own lifecycle state untouched, and expose no Delete route or Delete control anywhere in the panel.
- **EARS-3** _(realizes: US-1, US-2, US-3, US-10 · wave: core)_ — When any surface reads an event's recording state, one canonical resolver shall derive it from published non-retired rows alone — both kinds present yields the edited recording in the main player and the raw capture as the secondary, raw alone yields the raw recording in the main player with no secondary, edited alone yields it with no secondary, and none yields the preparing state — so that publishing the edited cut later promotes it and demotes the raw capture with no operator page edit and no stored ordering flag.
- **EARS-4** _(realizes: US-1, US-4, US-15 · wave: core)_ — When a visitor with no account opens `/webinars/[slug]` for a finished event, the page shall render its post-live state on that same route with the announcement, description, speakers, project or projects, topics and materials all present and readable, built from `design-source/webinar-archive.dc.html`, and the public API response shall carry the source-free recording projection only; no second route, mirror page or hidden-announcement variant shall exist for the archived state.
- **EARS-5** _(realizes: US-1, US-5, US-12 · wave: core)_ — When an unauthenticated visitor reaches the player position of a post-live page, the server shall omit every playable source reference from the response and the page shall render the canvas guest gate — dimmed poster plus a boxed, plainly worded invitation stating that viewing requires a free account with a real labelled sign-in action — and when the same visitor is authenticated the playback endpoint shall return the resolver-selected playable source; a client-side-only gate, a hidden-but-present source, or a paywall framing shall each be a defect.
- **EARS-6** _(realizes: US-5, US-12 · wave: core)_ — When a visitor is sent to registration, login or verification from a login-gated surface, the platform shall carry a same-origin return target through that flow and land the visitor back on the exact page they were consuming on first authenticated navigation, falling back to the surface's default landing only when no valid target exists; a non-same-origin or absolute target shall be rejected rather than followed. This is the platform-wide rule the owner set on 2026-08-17; 014 realizes it for its own gated surfaces.
- **EARS-7** _(realizes: US-6 · wave: core)_ — When a finished event has no published non-retired recording, the page shall render the honest «запись готовится» plaque in the player's position, stating the per-event readiness date the operator set on `events.recording_expected_by` and an honest date-free line when it is unset; the plaque shall disappear by itself the moment a recording is published and reappear correctly if that recording is later unpublished or retired, with no operator page edit in either direction. A published recording whose source is unavailable at playback shall instead render an explicit unavailability message with a retry affordance — never an empty or dead player.
- **EARS-8** _(realizes: US-3 · wave: core)_ — When both an edited and a raw recording are published for one event, the page shall present the raw capture through the canvas `secondaryUi` default `spoiler` — a collapsible «Смотреть оригинал трансляции» control beneath the main player, keyboard-operable and labelled — and shall render no secondary affordance at all when only one kind is published.
- **EARS-9** _(realizes: US-7, US-8 · wave: core)_ — When a registered doctor opens «Мои события», the surface shall render exactly the two canvas tabs «Предстоящие» and «Записи» with «Предстоящие» selected by default, list the doctor's full registration history newest-first inside each tab through the shared list unit rather than a section-local copy, include every past registered event in «Записи» even when no recording exists — carrying the preparing badge in that case — and link each entry to its event page.
- **EARS-10** _(realizes: US-13, US-16 · wave: core)_ — Before any 014 listing surface ships, the reusable event card, list and pagination unit shall exist once as a controlled component owned by feature 014, taking selected tab, page cursor and item data as props with change callbacks and issuing no data fetch of its own, so that `/webinars`, the project page, the expert page and «Мои события» render the same unit; a surface-local list, card or pager implementation shall be a defect.
- **EARS-11** _(realizes: US-13, US-15 · wave: core)_ — When any visitor opens `/webinars`, the listing shall offer «Предстоящие · N | Прошедшие · N» tabs mirroring the tab pattern already drawn on the project and expert pages, list finished events newest-first in the past tab with their recording-state badge, remain reachable with no account, keep the existing upcoming discovery behaviour and its «Неделя | Месяц» views unchanged, and open every entry on `/webinars/[slug]` in its post-live state.
- **EARS-12** _(realizes: US-14 · wave: facets)_ — When a visitor filters the event listing, the surface shall render the three searchable single-select dropdown facets Проект, Эксперт and Тема from `design-source/events-filter.dc.html` with per-option counts, active-filter badges carrying per-badge clear plus «Сбросить всё», and full-width stacked facets below the mobile breakpoint; a zero-yield option shall stay visible and selectable with its count simply absent rather than disabled or hidden.
- **EARS-13** _(realizes: US-14, US-16 · wave: facets)_ — When the listing request carries facet selections, the API shall compose them with AND — project ∧ expert ∧ topic — over feature 012's published non-retired taxonomy records and active joins, return the filtered page in one bounded paginated statement plus one companion facet-option query whose counts reflect the other facets' current selections but not the facet's own, return a successful empty page with terminal pagination for a zero-yield combination, and reject an unknown or ineligible facet id as 404 `RESOURCE_NOT_FOUND` without leaking a draft or retired taxonomy record.
- **EARS-14** _(realizes: US-16 · wave: facets)_ — When the facet capability lands, it shall land as a capability of the shared list unit from EARS-10 and its backing listing contract, so the project page, expert page and «Мои события» listings gain the same filtering by consuming the unit; a `/webinars`-only filter implementation, a forked copy of the unit, or a second filtering contract shall be a defect.
- **EARS-15** _(realizes: US-11 · wave: core)_ — When any 014 surface is rendered below the mobile breakpoint, the archived page, its player card, the secondary-recording control, the guest gate, the tabs, the pagination and the facets shall each render in the canvas mobile composition and remain fully operable; every new surface shall pass the `playwright-axe` gate with the player controls keyboard-reachable and every gate, tab, facet and pager control a real labelled interactive element.
- **EARS-16** _(realizes: US-1, US-4, US-5, US-6, US-7, US-8, US-13, US-14, US-15 · wave: core)_ — Before implementation of each 014 user-facing surface begins, the team shall run the `build-ui-from-design-system` gate against the vendored canvases as the composition source of truth, build from `@ds/design-system` primitives with full interaction states and tokens-only styling, and re-confirm the rendered result with the product owner on the live stand before merge; the recorded canvas defaults (`secondaryUi: spoiler`, «Мои события» two tabs, tabs mirroring the project and expert pages) shall be treated as decisions rather than re-opened questions.
- **EARS-17** _(realizes: US-9, US-10 · wave: core)_ — The system shall require one canonical UUID `Idempotency-Key` on every mutating recording endpoint — absent or blank is 428 `IDEMPOTENCY_KEY_REQUIRED`, malformed is 400 `IDEMPOTENCY_KEY_INVALID` — require the target ETag on every non-create method with 428 `PRECONDITION_REQUIRED` when absent and 412 `PRECONDITION_FAILED` when stale, accept only the dedicated MFA-verified admin session with `platform_admin` (401 `ADMIN_SESSION_REQUIRED`, 403 `PLATFORM_ADMIN_REQUIRED`), keep public announcement reads zero-auth and playback reads `authenticated` (401 `AUTHENTICATION_REQUIRED`), return every failure as an RFC 7807 Problem Details document with `traceId` and an exact `errorCode`, and record every committed recording mutation through feature 010's generic audit capture.

## Invariants

- No `event_recordings` row is physically deleted or cascade-deleted, and no recording id is reused; `event_recordings.event_id` is restrictive.
- At most one non-retired `event_recordings` row exists per `(event_id, kind)`; a retired row frees the slot while remaining addressable.
- `retired ⇔ deleted_at IS NOT NULL`; `first_published_at` is monotone — set once, never cleared, unaffected by unpublish, retire or restore.
- No response reachable without an authenticated session contains a playable source reference for any recording.
- Exactly one of `montage`, `raw-only` or `preparing` describes a finished event at every committed state, and it is derived — never stored.
- The player position of a finished event is never empty: it holds a player, the guest gate, the plaque, or the explicit unavailability message.
- `/webinars/[slug]` is the only route rendering an event page, pre-live or post-live.
- The tabs, pagination and facet controls exist in exactly one shared unit; every consuming surface renders that unit.
- No 014 table stores a project, expert or topic; facet data comes from 012's public reads only.
- «Мои события» renders exactly two tabs, and «Записи» contains every past registered event regardless of recording presence.
- A listing request costs a bounded number of statements independent of page size.

## Verification

| EARS   | Test type                               | Indicative target                                                                              | Required proof                                                                                                                                                                                                                   |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2    | Vitest e2e + DB constraints + migration | `apps/api/test/recordings/lifecycle.e2e-spec.ts`                                               | Attach yields draft; kind-slot conflict 409 and its release by retire; publish/unpublish/retire/restore transitions; set-once `first_published_at`; unfinished-event publish refusal; absence of any DELETE path or route.       |
| 3      | Vitest unit + e2e                       | `apps/api/test/recordings/projection.spec.ts`                                                  | All four resolver inputs (both kinds, raw only, edited only, none); the same resolver feeds page, playback, «Мои события» and archive badge; no stored ordering column exists.                                                   |
| 4–5    | Vitest e2e + Playwright                 | `apps/api/test/recordings/public-reads.e2e-spec.ts`, `apps/portal/e2e/webinar-archive.spec.ts` | Anonymous response body contains the full announcement and zero source reference; authenticated playback returns the selected source; single-route assertion; guest gate rendered with a real sign-in action.                    |
| 6      | Vitest e2e + Playwright                 | `apps/portal/e2e/return-to-origin.spec.ts`                                                     | Guest → gate → register/login → lands back on the same recording; verification-mail branch; absolute and cross-origin targets rejected in favour of the default landing.                                                         |
| 7      | Vitest e2e + Playwright                 | `apps/portal/e2e/webinar-archive.spec.ts`                                                      | Plaque with the operator date and without it; plaque clears on publish and returns on unpublish/retire with no page edit; unavailable-source message with retry.                                                                 |
| 8      | Playwright                              | `apps/portal/e2e/webinar-archive.spec.ts`                                                      | Spoiler present only when both kinds are published; keyboard operation; labelled control; absent for single-kind events.                                                                                                         |
| 9      | Vitest e2e + Playwright                 | `apps/api/test/recordings/my-events.e2e-spec.ts`, `apps/portal/e2e/my-events.spec.ts`          | Exactly two tabs, default «Предстоящие»; full history newest-first per tab; past event without a recording present with the preparing badge; the shared unit renders the list.                                                   |
| 10, 14 | Vitest unit + contract + Playwright     | `packages/design-system` / portal unit tests, `apps/portal/e2e/event-list-unit.spec.ts`        | The unit is controlled and fetch-free; every consuming surface renders it; the facet capability lands inside it with no forked copy and no second filtering contract.                                                            |
| 11     | Vitest e2e + Playwright                 | `apps/api/test/events/archive-listing.e2e-spec.ts`, `apps/portal/e2e/webinars-tabs.spec.ts`    | Tab counts; past ordering newest-first; anonymous reachability; recording badges; unchanged upcoming and «Неделя \| Месяц» behaviour.                                                                                            |
| 12–13  | Vitest e2e + Playwright                 | `apps/api/test/events/facets.e2e-spec.ts`, `apps/portal/e2e/events-filter.spec.ts`             | AND composition across three facets; counts excluding the facet's own selection; zero-yield option visible, count-free and selectable; empty page terminal pagination; unknown id 404; bounded statement count; mobile stacking. |
| 15     | Playwright + axe + UI lint              | `apps/portal/e2e/webinar-archive.spec.ts`, `apps/portal/e2e/webinars-tabs.spec.ts`             | Both breakpoints and both themes; axe clean; keyboard reach on player, spoiler, tabs, facets and pager; token-only styling.                                                                                                      |
| 16     | Owner record + Playwright               | Stage-A record in `014-product.md`; Stage-B verdict on the Issue                               | Canvas-derived composition verified against the vendored files; owner live-stand confirmation before merge.                                                                                                                      |
| 17     | Vitest e2e                              | `apps/api/test/recordings/protocol.e2e-spec.ts`                                                | Idempotency and ETag outcomes; admin-session and role outcomes; public vs authenticated read authorization; exact Problem Details codes; audit rows for every committed mutation.                                                |
| all    | Playwright BDD                          | `014-scenarios.feature`                                                                        | Every EARS tag executes against the real portal → NestJS → Postgres stack; no stub, seed-only or fake-source acceptance.                                                                                                         |

## Dependencies and sequencing

- **`core` has no feature-012 dependency.** It builds on feature 004 (public event page and listing), feature 007 (the admin event detail and its idempotency/authorization precedent), feature 005 (registrations, the source of «Мои события») and feature 010 (generic audit capture).
- **`facets` is blocked by the 012 relations wave.** EARS-12, EARS-13 and EARS-14 read 012's public taxonomy entities and event joins; their child Issues carry `blocked_by` edges to the 012 relationship Issues, with the rationale recorded on the edge.
- **014 owns the shared event card/list/pagination unit** (epic decision #7), because 014 starts before the 013 build. EARS-10 must land before EARS-9 and EARS-11 consume it, and before the 013, 015 and 016 listing surfaces are built.
- **Feature 013** ([#1324](https://github.com/doctor-school/ds-platform/issues/1324)) consumes the same list unit and the same return-to-origin mechanism; its inline rewrite for the post-login default is tracked there, not here.
- **Related:** [#1188](https://github.com/doctor-school/ds-platform/issues/1188) / Plane DSP-229 is delivered by EARS-9 and is not specified separately. The platform-wide return-to-origin rule (EARS-6) is carried into the 003/008 auth flows by their own next touch; 014 defines the mechanism and does not edit those triplets.
- **The video hosting decision is upstream of a real playable source.** EARS-1 stores a source reference behind the existing provider abstraction that feature 006 already uses for the live room; no 014 clause depends on a new hosting choice, and none may be satisfied by a fake source.
