---
title: "014 — Event recordings and the archived-event page (Design)"
description: "Design for retained event_recordings, the ended-only definition of a finished event plus the MarkEventEnded backfill that makes off-platform broadcasts publishable, the derived edited-over-raw projection, the two-layer public/authenticated read split that implements the login gate, the operator-dated preparing plaque, the platform-wide post-login return-to-origin mechanism, «Мои события» tabs over the registration history, and the shared event card/list/pagination unit with its URL-persisted state and facet capability."
slug: 014-event-recordings-design
status: Draft
tracker: https://github.com/doctor-school/ds-platform/milestone/12
lang: en
---

# 014 — Event recordings and the archived-event page (Design)

Requirements: [`014-requirements-en.md`](./014-requirements-en.md) · PRD: [`014-product.md`](./014-product.md) · Canvases: `design-source/webinar-archive.dc.html`, `design-source/events-filter.dc.html`, `design-source/my-events.dc.html`.

Every EARS clause in the requirements carries a `wave: core | facets` tag. This design marks each section the same way, so an implementation Issue reads its layer boundaries and its wave from one place.

## 1. Architecture

014 is one vertical spanning `packages/db` (the retained `event_recordings` table, the `events.recording_expected_by` column and their migration), `packages/schemas` (the Zod/OpenAPI SSOT for recording admin commands, the source-free public projection and the authenticated playback contract), `apps/api` (admin commands, public reads, playback read, archive listing, facet reads), the generated `@ds/api-client`, `apps/admin` (the recordings panel on the existing feature-007 event detail) and `apps/portal` (the post-live page state, «Мои события», the `/webinars` tabs, and the shared list + facet units).

It adds no second content store and no new provider abstraction: the playable source reference reuses the `stream_provider` / `embed_ref` shape that `stream_config` already uses for the live room in feature 006.

```mermaid
flowchart LR
  ADM[apps/admin — feature-007 event detail + recordings panel]
  PORTAL[apps/portal — /webinars, /webinars/slug, /account/events]
  APIA["apps/api /v1/admin — platform_admin"]
  APIP["apps/api /v1/public — zero-auth reads"]
  APIU["apps/api /v1 — authenticated reads"]
  SCH[packages/schemas — Zod + OpenAPI]
  DB[(Postgres — events, event_recordings, registrations, audit_ledger)]
  TAX["012 public taxonomy reads — projects, experts, topics"]
  MEDIA[[Video provider / CDN — poster + embed source]]

  ADM -->|"attach, publish, retire; Idempotency-Key + If-Match"| APIA
  APIA --> SCH
  APIP --> SCH
  APIU --> SCH
  APIA --> DB
  APIP --> DB
  APIU --> DB
  PORTAL -->|announcement, tabs, listing| APIP
  PORTAL -->|playable source, my-events| APIU
  APIP -.->|facets wave| TAX
  APIU -->|embed ref only| MEDIA
  PORTAL -->|poster + player| MEDIA
```

The single hard boundary in this design is the one drawn by the login gate: **`APIP` never emits a playable source.** That is a contract fact, asserted on the response body, not a rendering rule in the portal.

### 1.1 «Finished» is one state

Every 014 rule keyed on «finished» reads `EventLifecycleState = ended` and nothing else. `archived` is deliberately excluded: feature 004 routes a cancelled or never-aired event `published -> archived` and renders it as a notice with no CTA, absent from every public listing (`004-design.md` visibility policy, owner variant «а»). Treating `archived` as post-live would hand a player to a broadcast that never happened and would contradict a merged contract. 014 therefore supersedes no 004 clause; the requirements carry the full state table.

That leaves one real gap, which §3.1 closes: on this platform `ended` is reachable only through `OpenRoom` + `CloseRoom`, so every эфир held before features 006/007 existed, or run off-platform, could never become finished and its recording could never be published — the archive the PRD premises would ship empty.

## 2. Data model (`wave: core`)

```mermaid
erDiagram
  events ||--o{ event_recordings : "has (RESTRICT)"
  events ||--o{ registrations : "has"
  events ||--o| stream_config : "live room (006)"

  events {
    uuid id PK
    text slug UK
    event_lifecycle_state state
    timestamptz starts_at
    date recording_expected_by "NEW — nullable, operator-set"
  }
  event_recordings {
    uuid id PK
    uuid event_id FK "RESTRICT"
    recording_kind kind "edited | raw"
    stream_provider provider
    text embed_ref
    text poster_ref "nullable"
    integer duration_sec "nullable"
    recording_status status "draft | published | retired"
    timestamptz first_published_at "nullable, set once"
    timestamptz deleted_at "nullable"
    integer version "monotonic"
    timestamptz created_at
    timestamptz updated_at
  }
```

- New enums: `recording_kind ('edited','raw')`, `recording_status ('draft','published','retired')`.
- Partial unique index — the LD-1 at-most-one-per-kind rule, written so a retired row frees the slot:
  `CREATE UNIQUE INDEX event_recordings_event_kind_active_uniq ON event_recordings (event_id, kind) WHERE deleted_at IS NULL;`
- Read index for the projection and the listing badge:
  `CREATE INDEX event_recordings_event_published_idx ON event_recordings (event_id, kind) WHERE status = 'published' AND deleted_at IS NULL;`
- `events.recording_expected_by` is a `date`, not a timestamp: the plaque promises a day, and a timezone-bearing instant would invite a false precision the operator never entered.
- `event_id` is `RESTRICT` / `NO ACTION` per ADR-0003 §4. No 014 path issues `DELETE`.
- The table joins feature 010's generic audit trigger; there is no 014-specific audit table and no technical-table exclusion.

**Migration order.** One migration adds the two enums, the table, both indexes and the `events` column. It is additive and backward-compatible: existing event reads are unaffected until the projection ships, so the schema Issue can land ahead of the API Issue without a partial-deployment hazard.

## 3. Recording lifecycle (`wave: core`)

```mermaid
stateDiagram-v2
  [*] --> draft : AttachRecording (kind slot free)
  draft --> published : PublishRecording (event state = ended)
  published --> draft : UnpublishRecording
  draft --> retired : RetireRecording
  published --> retired : RetireRecording
  retired --> draft : RestoreRecording (kind slot free again)
  note right of published
    first_published_at set once here.
    Unpublish / retire / restore never clear it.
  end note
  note left of retired
    deleted_at set. Row retained and
    addressable; the (event_id, kind)
    slot is released.
  end note
```

Refusals:

| Attempt                                                               | Result                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Attach a kind that already has a non-retired row                      | 409 `RECORDING_KIND_OCCUPIED` naming that row                  |
| Publish while the event is `draft`, `published`, `live` or `archived` | 409 `EVENT_NOT_FINISHED` — publishing requires exactly `ended` |
| Restore while the kind slot is taken by another row                   | 409 `RECORDING_KIND_OCCUPIED`                                  |
| Any transition not on the diagram                                     | 409 `INVALID_TRANSITION`                                       |
| Stale `If-Match`                                                      | 412 `PRECONDITION_FAILED`, no mutation                         |
| Any Delete attempt                                                    | No route exists — 404 from the router, never a soft delete     |

### 3.1 Reaching `ended` for a broadcast the platform never hosted (`wave: core`)

Feature 007's transition set is closed and server-enforced, and `ended` sits behind `OpenRoom` + `CloseRoom`. Every эфир held before features 006/007 existed, and every эфир run off-platform, is therefore stuck at `published` — and under the §3 publish gate its recording could never be published. That is not an edge case: it is the launch content of the archive.

014 does **not** loosen the guard. It adds exactly one new legal edge behind one narrow operator command.

```mermaid
stateDiagram-v2
  published --> live : OpenRoom (007, unchanged)
  live --> ended : CloseRoom (007, unchanged)
  published --> ended : MarkEventEnded (014 — no room was ever opened)
  ended --> archived : ArchiveEvent (007, unchanged)
  published --> archived : ArchiveEvent (004 — cancelled / never aired, unchanged)
```

`MarkEventEnded` — admin label «Отметить завершённым (трансляция прошла вне платформы)»:

| Aspect        | Contract                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preconditions | `state = published` **and** `starts_at + duration_min` already in the past **and** the room was never opened                                              |
| Effect        | `published → ended` in one transaction; no `live` state, no room record, no presence window, no recording                                                 |
| Authorization | ordinary `platform_admin` on the dedicated admin session — no new role, no elevation                                                                      |
| Protocol      | `If-Match` on the event ETag + `Idempotency-Key`, exactly like every other 007 transition                                                                 |
| Refusals      | 409 `EVENT_NOT_PAST` when the scheduled end is still in the future; 409 `INVALID_TRANSITION` from any other origin state or when the room was ever opened |
| Audit         | one feature-010 row, like every other lifecycle transition                                                                                                |
| Admin UI      | derived from `EventAdminDetail.validTransitions` as 007 already does, so the control appears only when the precondition holds                             |

Two boundaries keep this from becoming a general "set any state" escape hatch: the never-opened-room condition means it can never rewrite the history of a broadcast the platform actually hosted, and the past-end condition means it can never pre-declare a future эфир finished. A cancelled or never-aired event keeps feature 004's `published → archived` route and never becomes finished by this command.

Because feature 007 runs in production, its extended transition set is recorded in `007-design.md` as an **amendment block** naming 014 as the source (AGENTS.md §6 amendment rule) rather than as an inline rewrite of its state machine.

## 4. The derived projection (`wave: core`)

One resolver, `resolveRecordingProjection(eventId | eventIds)`, is the only place the display rule lives.

```mermaid
flowchart TD
  A["published, non-retired rows for the event"] --> B{edited present?}
  B -- yes --> C{raw present?}
  C -- yes --> D["state = montage<br/>primary = edited<br/>secondary = raw"]
  C -- no --> E["state = montage<br/>primary = edited<br/>secondary = null"]
  B -- no --> F{raw present?}
  F -- yes --> G["state = raw-only<br/>primary = raw<br/>secondary = null"]
  F -- no --> H["state = preparing<br/>primary = null<br/>expectedBy = events.recording_expected_by"]
```

Four consumers, one resolver:

| Consumer                                  | What it takes from the projection                                  |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `GET /v1/public/events/:idOrSlug`         | `state`, `primaryKind`, `secondaryKind`, `posterUrl`, `expectedBy` |
| `GET /v1/events/:idOrSlug/recordings`     | `primaryKind` / `secondaryKind` → the playable rows                |
| `GET /v1/public/events` (archive listing) | `state` only, as `PublicEventSummary.recordingState`               |
| `GET /v1/me/events`                       | `state` only, per registered past event                            |

The batch form takes an id array and returns a map, so a listing page resolves every card's badge in one statement — the LD-8 bounded-query rule. A per-card call is the N+1 shape review refuses.

## 5. The login gate as a read split (`wave: core`)

```mermaid
sequenceDiagram
  participant G as Guest browser
  participant P as apps/portal (RSC)
  participant PUB as "/v1/public/events/:idOrSlug"
  participant AUTH as "/v1/events/:idOrSlug/recordings"

  G->>P: GET /webinars/finished-slug
  P->>PUB: read announcement + recording projection
  PUB-->>P: full announcement, {state: montage, posterUrl, no source}
  P-->>G: post-live page, guest gate in the player position
  G->>P: click «Войти, чтобы смотреть»
  P-->>G: 302 to /login?returnTo=/webinars/finished-slug
  Note over G,P: registration / login / email verification
  G->>P: authenticated navigation, returnTo consumed
  P->>PUB: announcement (same public read)
  P->>AUTH: playable source
  AUTH-->>P: {primary: {kind: edited, provider, embedRef}, secondary: {kind: raw, ...}}
  P-->>G: player + «Смотреть оригинал трансляции» spoiler
```

- The public read is identical for a guest and for a signed-in doctor, which keeps it cacheable and keeps one announcement projection under test.
- The authenticated read is the only source-bearing response in the feature. Its guard is `access: authenticated`; it checks no registration, no role, no attendance.
- A `preparing` event returns 200 with `{primary: null, secondary: null}` on the authenticated read too — the plaque is not an error.
- The API hands out an embed reference and never fetches the media, so it has no way to know the provider is unreachable. Player unavailability is therefore a **client** branch: the portal's player boundary treats a load error or a load timeout as the honest «запись временно недоступна» state with a retry action. There is no server status for it, and there must be no fake one.
- The portal renders the player in a client boundary that receives the `embedRef` from the server component; the source never lands in a public HTML payload for a guest.

## 6. Return-to-origin (`wave: core`, platform-wide rule)

The owner's rule is broader than 014: _any_ login-gated content returns the user to the page they were consuming. This design implements it once, as a portal-auth mechanism, and 014 is its first consumer.

```mermaid
flowchart LR
  GATE["gated surface<br/>builds returnTo = current path"] --> ENTRY["/login or /register<br/>?returnTo=…"]
  ENTRY --> VALID{"same-origin<br/>relative path?"}
  VALID -- no --> DEF["drop it; use the surface default landing"]
  VALID -- yes --> COOKIE["signed, short-lived returnTo cookie"]
  COOKIE --> FLOW["registration → email verification → login"]
  FLOW --> FIRST["first authenticated navigation"]
  FIRST --> CONSUME["consume once, redirect, clear"]
```

Rules the mechanism must satisfy:

- Accept only a relative path on this origin. An absolute URL, a protocol-relative `//host`, a backslash-escaped variant or a path escaping the app are dropped in favour of the default landing — the mechanism must never become an open redirect.
- Survive the interruption of email verification, because the registration branch leaves the browser and comes back.
- Consume exactly once, then clear, so a later unrelated login does not teleport the user into an old page.
- Have a per-surface default landing when no target exists. For 013 that default is `/webinars` ([#1324](https://github.com/doctor-school/ds-platform/issues/1324)) — a default, never an override of a present target.

014 owns the mechanism and its `/webinars/[slug]` consumer. Carrying it into the 003/008 auth triplets and the 013 default is tracked outside this spec.

## 7. Operator surface (`wave: core`)

The recordings panel is a section of the existing feature-007 event detail in `apps/admin`, not a new Refine resource tree — an operator attaches a recording while looking at the event, which is where they already are.

```mermaid
sequenceDiagram
  participant OP as Operator (platform_admin)
  participant RF as apps/admin (Refine)
  participant API as "/v1/admin/events/:id/recordings"
  participant DB as Postgres

  OP->>RF: open event detail → Recordings panel
  RF->>API: POST (kind, provider, embedRef, poster?) + Idempotency-Key
  API->>DB: insert draft; partial unique index guards the kind slot
  DB-->>API: row v1
  API-->>RF: 201 + ETag
  OP->>RF: Publish
  RF->>API: POST :recordingId/publish + If-Match + Idempotency-Key
  API->>DB: check event finished; set published + first_published_at once
  API-->>RF: 200 + ETag v2
  Note over OP,RF: the public page changes by itself — no page edit
```

Panel contract: one row per kind with its status chip, the source and poster fields, the action set from §3, and the event-level readiness-date field beside it. No Delete control exists anywhere in the panel; retire is the terminal action and it is reversible.

## 8. Portal surfaces (`wave: core`)

### 8.1 `/webinars/[slug]` post-live state

Built from `design-source/webinar-archive.dc.html`, whose props map one-to-one onto the projection:

| Canvas prop                                   | Source                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `viewer: authed \| guest`                     | session presence                                         |
| `recording: montage \| raw-only \| preparing` | `RecordingProjection.state`                              |
| `secondaryUi: spoiler`                        | fixed — the canvas default is the operative Stage-A pick |

The page is the same route and the same layout as the pre-live state; the hero, meta row, «О чём эфир» timecode rows, speaker/materials aside and bottom CTA are the canvas composition. The player card holds exactly one of: the player, the guest gate, the plaque, or the unavailability message.

**Content fields split across the two waves.** The `core` page renders every field of feature 004's existing `PublicEventPage` allow-list — title, school, start instant, duration, description, `speakers[]`, `specialties[]`, `partners[]`, `programPdfUrl?` — and is complete on its own. The event's **project(s) and topics** are 012 entities that the 004 projection does not carry, so they are EARS-19 in the `facets` wave; until it lands those two blocks are simply absent, never a placeholder or a «скоро» stub. This is why the `core` wave's «no 012 dependency» claim holds for the page as well as for the listing.

### 8.2 The shared event card / list / pagination unit

014 builds it (epic decision #7) because 014 starts before the 013 build. Two controlled, fetch-free components:

- `EventList` — props `items`, `tab`, `counts`, `pageCursor`, `onTabChange`, `onPageChange`; renders the `ВебинарКарточка` card, the tab bar and the pager.
- `EventFilters` — props `project`, `expert`, `topic`, `projects`, `experts`, `topics`, `counts`, `onChange`; the `events-filter.dc.html` shape exactly (`wave: facets`).

```mermaid
flowchart TD
  UNIT["EventList + EventFilters<br/>(controlled, no fetching)"]
  W["/webinars — core tabs, facets wave"] --> UNIT
  MY["/account/events — «Мои события»"] --> UNIT
  PP["project page (015)"] --> UNIT
  EP["expert page (016)"] --> UNIT
  H["home (013)"] --> UNIT
```

Because the unit does not fetch, the `facets` wave adds a capability to it without touching the `core` surfaces already consuming it — that is the whole reason for the controlled shape.

### 8.3 «Мои события»

Exactly two tabs — «Предстоящие» (default) and «Записи» — per the owner's canvas decision; the canvas's third «Сертификаты» tab is a review miss and is not built. Each tab is the full registration history for its side, newest first, over `registrations ⋈ events`, with the projection's `state` supplying the per-row badge. A past registered event with no recording is present and carries the preparing badge.

### 8.4 `/webinars` tabs

«Предстоящие · N | Прошедшие · N», mirroring the tab pattern already drawn on `project-page.dc.html` / `expert-page.dc.html`. Tab membership is `ended` for the past tab and feature 004's existing upcoming rule for the other; `draft` and `archived` are in neither tab and in neither count. The «Неделя | Месяц» views' rendering and the upcoming discovery behaviour are untouched — this is a refinement, not a redesign.

**State persistence follows LD-11** (requirements → Lead technical decisions): the selected tab, every facet value, the page cursor **and** the week/month view are query parameters of `/webinars`. One surface, one persistence rule — the week/month switcher moves onto the same mechanism rather than keeping its own, because mixed persistence on one page is a fidelity trap. The rationale (linkable filtered archive, reload and back/forward survival, and the fact that a deliberately fetch-free unit leaves the URL as the only place a server component can read the selection from) is recorded there as a lead decision, since the PRD left URL persistence to Stage A and no canvas carries it.

## 9. Facets (`wave: facets`)

```mermaid
sequenceDiagram
  participant V as Visitor
  participant P as apps/portal
  participant L as "/v1/public/events?timeframe=past&projectId=…&expertId=…"
  participant F as "/v1/public/events/facets?timeframe=past&…"
  participant DB as Postgres (012 taxonomy joins)

  V->>P: pick Проект, then Эксперт
  P->>L: one bounded paginated query, AND-composed
  P->>F: one companion facet-option query
  L->>DB: filtered page
  F->>DB: option lists + counts
  F-->>P: zero-yield options included, count = null
  P-->>V: filtered list + active-filter badges + «Сбросить всё»
```

- AND across facets: project ∧ expert ∧ topic. Single-select per facet, per the canvas.
- A facet's option counts reflect the _other_ facets' current selections, not its own — otherwise selecting a value collapses its own list to one option.
- A zero-yield option is returned with `count: null` and stays selectable; the resulting empty page is a successful terminal-pagination response, not a 404.
- Filtering happens in SQL over 012's join tables with its published/active allow-lists at every hop. 014 stores no taxonomy and issues no per-card taxonomy call.
- An unknown or ineligible facet id is 404 `RESOURCE_NOT_FOUND` — it must not distinguish a draft or retired taxonomy record from a nonexistent one.

## 10. API surface

| Method | Path                                             | Access           | Wave   |
| ------ | ------------------------------------------------ | ---------------- | ------ |
| POST   | `/v1/admin/events/:id/recordings`                | `platform_admin` | core   |
| PATCH  | `/v1/admin/events/:id/recordings/:rid`           | `platform_admin` | core   |
| POST   | `/v1/admin/events/:id/recordings/:rid/publish`   | `platform_admin` | core   |
| POST   | `/v1/admin/events/:id/recordings/:rid/unpublish` | `platform_admin` | core   |
| POST   | `/v1/admin/events/:id/recordings/:rid/retire`    | `platform_admin` | core   |
| POST   | `/v1/admin/events/:id/recordings/:rid/restore`   | `platform_admin` | core   |
| GET    | `/v1/admin/events/:id/recordings`                | `platform_admin` | core   |
| PATCH  | `/v1/admin/events/:id` (`recordingExpectedBy`)   | `platform_admin` | core   |
| GET    | `/v1/public/events/:idOrSlug`                    | `public`         | core   |
| GET    | `/v1/public/events` (`timeframe`, cursor)        | `public`         | core   |
| GET    | `/v1/public/events/facets`                       | `public`         | facets |
| GET    | `/v1/events/:idOrSlug/recordings`                | `authenticated`  | core   |
| GET    | `/v1/me/events` (`tab=upcoming\|recordings`)     | `doctor_guest`   | core   |
| POST   | `/v1/admin/events/:id/mark-ended`                | `platform_admin` | core   |

No Delete route exists for any 014 resource. `/v1/public/events` and `/v1/public/events/:idOrSlug` are extensions of the existing feature-004 controllers, not new ones; `/v1/me/events` extends the existing feature-005 controller and keeps that feature's `doctor_guest` classification, so the endpoint-authz matrix carries one wording for it rather than two. `/v1/admin/events/:id/mark-ended` extends the feature-007 admin controller.

## 11. Errors

RFC 7807 Problem Details with `traceId` and an exact `errorCode`, per ADR-0002 §9.

| Status | Codes                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`, `CURSOR_INVALID`, `IDEMPOTENCY_KEY_INVALID`                                                  |
| 401    | `AUTHENTICATION_REQUIRED` (playback), `ADMIN_SESSION_REQUIRED` (admin)                                            |
| 403    | `PLATFORM_ADMIN_REQUIRED`                                                                                         |
| 404    | `RESOURCE_NOT_FOUND` (unknown/ineligible event, recording or facet id — one shape)                                |
| 409    | `RECORDING_KIND_OCCUPIED`, `EVENT_NOT_FINISHED`, `EVENT_NOT_PAST`, `INVALID_TRANSITION`, `IDEMPOTENCY_KEY_REUSED` |
| 412    | `PRECONDITION_FAILED`                                                                                             |
| 428    | `IDEMPOTENCY_KEY_REQUIRED`, `PRECONDITION_REQUIRED`                                                               |

014 defines **no 5xx of its own**, and deliberately no `RECORDING_SOURCE_UNAVAILABLE`: the API returns an embed reference and never fetches the media, so a server status for «source unreachable» would have no producer. The portal's player boundary owns the honest «запись временно недоступна» message and its retry action (§5, EARS-7 second branch); a dead or forever-spinning player is never an acceptable rendering of it.

## 12. Design-system and Stage gates

- Every new surface runs the `build-ui-from-design-system` gate first; the vendored canvases are the composition source of truth, read from the files rather than from prose.
- The recorded canvas defaults are decisions, not questions: `secondaryUi: spoiler`; «Мои события» = two tabs; the `/webinars` past control = tabs mirroring the project and expert pages.
- Stage A is already recorded in `014-product.md` → «Approved mockup». Stage B is a live-stand owner confirmation per surface before merge.
- `design-source/README.md` carries the note that the canvas's «Сертификаты» tab is out of 014's scope (owner, 2026-08-17, canvas review miss) — the vendored copy is not edited here, since it is a verbatim mirror of the owner's canvas.

## 13. Sequencing

```mermaid
flowchart LR
  S["schema + migration (EARS-1/2)"] --> A["admin panel + readiness date"]
  MB["mark-ended backfill (EARS-18)"] --> A
  S --> R["resolver + public/auth read split (EARS-3/4/5)"]
  R --> PG["post-live page + plaque + spoiler (EARS-7/8)"]
  RT["return-to-origin mechanism (EARS-6)"] --> PG
  U["shared list unit (EARS-10 build)"] --> TB["/webinars tabs (EARS-11)"]
  U --> ME["«Мои события» (EARS-9)"]
  R --> TB
  R --> ME
  TWELVE["012 relations wave"] --> FA["facet unit + AND filtering (EARS-12/13/14)"]
  TWELVE --> PT["projects + topics on the page (EARS-19)"]
  PG --> PT
  U --> FA
  PG --> AX["mobile + axe sweep (EARS-15)"]
  TB --> AX
  FA --> AX
```

`core` runs end to end without the 012 track. Only the two `facets` boxes wait, and they wait on 012's relations wave rather than on anything inside 014.

**EARS-18 comes first in practice.** Without the backfill command there is no `ended` event outside the platform's own room history, so the admin panel has nothing publishable to attach a recording to and the archive ships empty. It is cheap, it touches one command handler plus the 007 amendment, and it unblocks every downstream demonstration of the feature.

Two clauses are **process gates rather than code Issues** and must not be opened as implementation work: EARS-10's «the unit exists once and everyone consumes it» ownership rule (the unit's actual build lands with the first consuming surface, and the rule is verified by the unit contract test) and EARS-16's Stage-A/Stage-B gate (verified by the recorded owner artifacts).
