# `events` — webinar event surface (007 authoring write side + 004 public read side)

The webinar event module. It hosts two surfaces over one aggregate:

- **007 authoring (write side)** — the admin **write model** of the webinar
  aggregate the rest of the epic reads projections of. `CreateEvent` + the two
  admin reads landed here; **EARS-7** lands the single closed-set lifecycle state
  machine — the server-enforced transition guard; **EARS-4** lands the first
  **named** transition command, `PublishEvent`
  (`POST /v1/admin/events/:id/publish`), which runs through that guard and
  appends its terminal `audit_ledger` row; **EARS-3** lands `ConfigureStream`
  (`PUT /v1/admin/events/:id/stream`), the explicit-provider-enum stream config
  the 006 room consumes; **EARS-5** lands the director's two air-day commands,
  `OpenRoom` (`POST /v1/admin/events/:id/open`, `published → live`) and
  `CloseRoom` (`POST /v1/admin/events/:id/close`, `live → ended`), each running
  through the EARS-7 guard and appending its terminal `audit_ledger` row;
  **EARS-2** lands the edit command, `UpdateEvent`
  (`PATCH /v1/admin/events/:id`), a pre-archive field edit with a **replaceable
  program PDF** (a new upload supersedes the stored reference so the 004 page
  serves the current file). The remaining named transition (archive) with its
  product side-effects + `audit_ledger` row is a sibling handler (EARS-6). The
  rendered stock-Refine admin surface + the browser E2E journey (incl. the admin
  publish action) are the integration slice (#595).
- **004 public read (read side)** — two **public** endpoints over publish-safe
  projections: the event-page endpoint (`GET /v1/public/events/:idOrSlug` →
  `PublicEventPage`, 004 EARS-1) and the upcoming-broadcasts listing
  (`GET /v1/public/events` → `UpcomingBroadcastCard[]`, 004 EARS-7). Both are
  unauthenticated, cacheable, with no per-session variation (004 EARS-10). The
  page's visibility policy (draft → 404, archived → 200 notice body) and the
  listing's filter (`published`/`live` at or after the air-window cutoff, ordered
  nearest air date first; empty → `[]`, EARS-11) live in the service. 004 owns no
  write path — it reads the state 007's transitions leave; until the 007 admin
  surface ships end-to-end, the read side is driven against **seeded fixture
  events** (seam → parent #549).

The admin routes are classified `access: authenticated`, `required_roles:
platform_admin`, `auth_check: fast-path` (007 EARS-8, ADR-0001 §2); the public
read route is `access: public`, `auth_check: none` (004 EARS-10). The global
`AuthzGuard` refuses `doctor_guest`/public callers on the admin routes and serves
the public routes without a subject. The DTO SSOT is `@ds/schemas`
(`packages/schemas/src/events`); the aggregate + speaker rows live in Postgres
via `@ds/db`; the program-PDF binary lives in object storage (the `storage`
module), only its reference on the aggregate.

## EARS-7 — the closed-set lifecycle guard

Lifecycle is one `EventLifecycleState` field with a **closed** transition set —
`draft→published→live→ended→archived` (the SSOT map `LIFECYCLE_TRANSITIONS` in
`@ds/schemas`). `POST /v1/admin/events/:id/transition` applies a move **only** if
it is one of the four legal forward transitions (`canTransition`); every invalid
jump — a skip-forward, any backward move, reopening `archived`, the
`published→draft` unpublish the PRD names none, or a self-transition — is refused
server-side with a **409** state conflict (`InvalidTransitionError`), and the
state is never mutated. A target outside the closed enum is a **400** (the
`ZodValidationPipe`, before the guard). The read models carry `validTransitions`
derived from the same map, so the admin UI offers only the currently-valid move
and can never disagree with the server. This bare guarded transition is what the
named commands (EARS-4/5/6) run through, layering their side-effects + audit rows
on top; it carries no `audit_ledger` row itself.

## EARS-4 — the publish transition (`draft → published`)

`PublishEvent` (`POST /v1/admin/events/:id/publish`) is the first **named**
lifecycle command. It runs through the EARS-7 guard — publish is refused with a
**409** unless the event is in `draft` (any non-draft origin raises
`InvalidTransitionError`, the state untouched) — and, on success, applies the
`draft → published` move **and appends exactly one** terminal `audit_ledger` row
**atomically** (`updateStateWithAudit`, one transaction), keyed to the acting
`platform_admin` (`event_type = event.published`; `metadata` carries the
aggregate id + `from`/`to`, no PD — ADR-0003 §6). Publishing is the single
visibility signal: the same `EventLifecycleState` write flips the 004 public
page + upcoming listing reachable and opens 005 registration gating — one state,
no second boolean flag (EARS-9). There is no idempotent re-publish (a second
publish from `published` is the guard's 409). The admin publish **action** (stock
Refine, offered only from `draft` via `EventAdminDetail.validTransitions`) + the
browser E2E are the integration slice (#595); this handler ships the backend
command + its Vitest e2e.

## EARS-5 — the room-control transitions (`OpenRoom` / `CloseRoom`)

The director's two air-day commands, both named lifecycle transitions running
through the EARS-7 guard on top of the shared `namedTransition` helper (the same
guard + atomic `updateStateWithAudit` path as publish). `OpenRoom`
(`POST /v1/admin/events/:id/open`) applies `published → live` — **refused with a
409 unless the event is in `published`** — and appends one terminal
`audit_ledger` row (`event_type = event.went_live`); it opens the 006 room
(admission of registered doctors + presence capture start) and flips 004's "live
now" signal off the same `EventLifecycleState`. `CloseRoom`
(`POST /v1/admin/events/:id/close`) applies `live → ended` — **refused with a 409
unless the event is in `live`** — and appends one terminal `audit_ledger` row
(`event_type = event.ended`); it closes the 006 room (admission + heartbeat/chat
acceptance stop) and **bounds the presence window** (006 EARS-7). On refusal the
state is untouched and no audit row is written. 006's own admission/heartbeat/chat
refusal logic **consumes** this `live` window — it is out of this handler's scope
(publish EARS-4 and archive EARS-6 are the sibling transitions). `platform_admin`
-only (EARS-8). The admin open/close **actions** (stock Refine, each offered only
from its valid state via `EventAdminDetail.validTransitions`) + the browser E2E
are the integration slice (#595); this handler ships the backend commands + their
Vitest e2e.

## EARS-2 — the edit command + replaceable program PDF (`UpdateEvent`)

`UpdateEvent` (`PATCH /v1/admin/events/:id`) edits an event's authored fields at
any **pre-archive** state and, when a replacement `programPdf` rides the same
`multipart/form-data` request, **supersedes the stored object reference** so the
004 public page serves the **current** file and the superseded file is no longer
served. The operator **never has to unpublish** to correct a detail — an edit is
**not a state reversal**: the lifecycle `state` is untouched here (the PRD names
no `published → draft`, EARS-7), and `state` is not even a field of the edit
contract, so a client cannot smuggle a transition through the edit. The request
mirrors create — a `payload` JSON field (validated against the **partial**
`UpdateEventRequestSchema` in `@ds/schemas`, every field optional with **no
default** so an omitted key leaves the stored value and `partnerRef: null`
explicitly clears it) plus an **optional** `programPdf` file (a PDF-only
replacement carries no field edits, so an absent payload is an empty patch, not a
400). A present `speakers` list replaces the stored ordered list wholesale; the
МСК re-entry is re-folded into one canonical instant (`mskLocalToInstant`). A new
program PDF lands under a **fresh, event-scoped key** — the replacement never
overwrites the superseded object in place, so the aggregate simply points at the
new key. An edit to an **`archived`** event is refused with a **409**
(`EventNotEditableError`, `EVENT_EDITABLE_STATES` being the pre-archive
complement of the single terminal state); an unknown id is a **404**; a malformed
field is a **400**, and on any refusal the aggregate is untouched.
`platform_admin`-only (EARS-8); like create it is an authoring write, not a
lifecycle transition, so it owes **no** `audit_ledger` row (that obligation
attaches to EARS-4/5/6). The admin edit **form** (stock Refine, incl. the PDF
re-upload affordance) + its browser E2E are the integration slice (#595); this
handler ships the backend command + its Vitest e2e.

## EARS-3 — the stream config (`ConfigureStream`)

`ConfigureStream` (`PUT /v1/admin/events/:id/stream`) records the event's stream
config as `{ provider, embedRef }`: the provider is an **explicit** member of the
closed enum `rutube | youtube` (`StreamProviderSchema` in `@ds/schemas`), and the
embed reference is the **provider-scoped stream id — never a URL to be sniffed**
(the legacy mistake, recon §5). An out-of-enum provider is a **400** at the
`ZodValidationPipe`, before the handler, so **no config is recorded** for an
unknown provider. The write is an **idempotent upsert** — one `stream_config` row
per event (`event_id` PK) — so a wrong reference is **correctable while
`published`** by replacing the single row, **with no state reversal** (US-3).
Configuring outside the pre-air window (`draft` / `published` only, design §2 —
`STREAM_CONFIGURABLE_STATES`) is a **409** (`StreamNotConfigurableError`); the
config is meaningless once the broadcast is live/ended/archived. `platform_admin`
-only (EARS-8); it owes **no** `audit_ledger` row (that obligation attaches to the
lifecycle transitions, EARS-4/5/6). The config is surfaced on `EventAdminDetail`
(`streamConfig`, `null` until configured) and the 006 room instantiates the
player from exactly this persisted config, switching on `provider`. The admin
stream-config **form** (stock Refine) + its browser E2E are the integration slice
(#595); this handler ships the backend command + its Vitest e2e/unit.

## What's here

| Concern                                                                                        | File                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Module wiring                                                                                  | `events.module.ts`            |
| Admin HTTP surface (create + edit + reads + stream config + publish + open/close + transition) | `events.admin.controller.ts`  |
| Public HTTP surface (event-page read + upcoming listing)                                       | `events.public.controller.ts` |
| Command body DTOs (`{ to }`, `{ provider, embedRef }`)                                         | `events.dto.ts`               |
| Authoring + guard + projection logic                                                           | `events.service.ts`           |
| Drizzle data access (insert, reads, state update)                                              | `events.repository.ts`        |

## Exported symbols

- **`EventsModule`** (`events.module.ts`) — registers the controllers +
  service + repository. Depends on the `@Global` `DatabaseModule` (`DRIZZLE_DB`)
  and `StorageModule` (`OBJECT_STORAGE`).
- **`EventsService`** (`events.service.ts`) — `create()` (007 EARS-1: folds the
  МСК wall-clock into one canonical instant via `mskLocalToInstant`, uploads the
  program PDF to object storage, inserts the `draft` aggregate + ordered speaker
  rows), `update()` (007 EARS-2: the pre-archive field edit — refuses an
  `archived` event with `EventNotEditableError`, folds a МСК re-entry into one
  instant, replaces the ordered speaker list when present, and supersedes the
  program-PDF reference when a replacement rides the request, leaving the
  lifecycle `state` untouched), `list()` (`EventAdminList`), `detail()`
  (`EventAdminDetail`),
  `transition()` (007 EARS-7: the closed-set guard — validates `current → to` via
  `canTransition`, refuses an invalid move with `InvalidTransitionError`, else
  persists the new state), `publish()` (007 EARS-4: the named `draft → published`
  command — runs the guard, then persists the move + one terminal `audit_ledger`
  row atomically keyed to the acting admin), `openRoom()` / `closeRoom()` (007
  EARS-5: the director's `published → live` / `live → ended` room-control
  commands — the same guarded, audited path as publish via the shared private
  `namedTransition()` helper, appending `event.went_live` / `event.ended`), and
  `publicEventPage()` (004 EARS-1:
  applies the
  visibility policy — `draft` → null → 404 — and projects the publish-safe
  allow-list `PublicEventPage`, mapping the internal `regalia`/`partnerRef` to
  the public `credentials`/`partners[].label`, omitting `programPdfUrl` when
  absent), and `listUpcoming()` (004 EARS-7: reads the `published`/`live` events
  at or after `now − AIR_WINDOW_MS`, nearest air date first, and projects the
  thin `UpcomingBroadcastCard` allow-list — name-only speakers, no
  operator/commercial field). Projects rows to the `@ds/schemas` read models,
  including `validTransitions` from the shared closed transition map.
  `configureStream()` (007 EARS-3: the closed-provider-enum stream config — validates
  the pre-air window, then upserts the single `stream_config` row via
  `upsertStreamConfig`, so a correction while `published` replaces it with no
  state reversal),
- **`InvalidTransitionError`** (`events.service.ts`) — the guard's HTTP-agnostic
  refusal (`from`/`to`); the controller maps it to a 409 state conflict.
- **`EventNotEditableError`** (`events.service.ts`) — EARS-2: `UpdateEvent`
  called on an `archived` event, outside the pre-archive edit window
  (`EVENT_EDITABLE_STATES`); the controller maps it to a 409 state conflict.
- **`StreamNotConfigurableError`** (`events.service.ts`) — EARS-3: `ConfigureStream`
  called outside the `draft`/`published` pre-air window; the controller maps it to
  a 409 state conflict. `STREAM_CONFIGURABLE_STATES` is the closed window set.
- **`EventsRepository`** (`events.repository.ts`) — the transactional insert
  (event + speakers land together or not at all), `updateEvent()` (the
  transactional field-patch + optional wholesale speaker-list replacement behind
  the EARS-2 edit command), the list/detail reads,
  `updateState()` (the bare lifecycle-state write behind the guard),
  `updateStateWithAudit()` (the state write + one terminal `audit_ledger` row in
  a single transaction — behind the named transition commands, EARS-4),
  `findByIdOrSlug()` (resolves the public read by stable slug or id), and
  `listUpcoming()` (the `published`/`live`-at-or-after-cutoff read ordered nearest
  first, with speaker rows batched in one query — no N+1) over the `events` /
  `event_speakers` tables.

## Endpoints

| Route                                  | Access               | Command / read                                                                                                                                 |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/admin/events`                | `platform_admin`     | `CreateEvent` (multipart: `payload` JSON + optional `programPdf` file)                                                                         |
| `PATCH /v1/admin/events/:id`           | `platform_admin`     | `UpdateEvent` (EARS-2 pre-archive edit; multipart: optional `payload` JSON + optional `programPdf`; replace supersedes ref; 409 if `archived`) |
| `GET /v1/admin/events`                 | `platform_admin`     | `EventAdminList`                                                                                                                               |
| `GET /v1/admin/events/:id`             | `platform_admin`     | `EventAdminDetail`                                                                                                                             |
| `PUT /v1/admin/events/:id/stream`      | `platform_admin`     | `ConfigureStream` (EARS-3 `{ provider ∈ rutube\|youtube, embedRef }`; upsert; 409 past pre-air window)                                         |
| `POST /v1/admin/events/:id/publish`    | `platform_admin`     | `PublishEvent` (EARS-4 `draft → published`; refused ≠ `draft`; +1 audit row)                                                                   |
| `POST /v1/admin/events/:id/open`       | `platform_admin`     | `OpenRoom` (EARS-5 `published → live`; refused ≠ `published`; +1 `event.went_live` audit row)                                                  |
| `POST /v1/admin/events/:id/close`      | `platform_admin`     | `CloseRoom` (EARS-5 `live → ended`; refused ≠ `live`; +1 `event.ended` audit row)                                                              |
| `POST /v1/admin/events/:id/transition` | `platform_admin`     | `TransitionEvent` (EARS-7 closed-set guard; body `{ to }`)                                                                                     |
| `GET /v1/public/events/:idOrSlug`      | **public** (no auth) | `PublicEventPage` (004 EARS-1) — `draft`/unknown → 404                                                                                         |
| `GET /v1/public/events` (`?upcoming`)  | **public** (no auth) | `UpcomingBroadcastCard[]` (004 EARS-7) — nearest first; empty → `[]`                                                                           |
