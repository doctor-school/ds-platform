# `events` — webinar event surface (007 authoring write side + 004 public read side)

The webinar event module. It hosts two surfaces over one aggregate:

- **007 authoring (write side)** — the admin **write model** of the webinar
  aggregate the rest of the epic reads projections of. `CreateEvent` + the two
  admin reads landed here; **EARS-7** lands the single closed-set lifecycle state
  machine — the server-enforced transition guard. The edit / stream-config
  commands and the four **named** transition commands with their product
  side-effects + `audit_ledger` rows are sibling handlers (EARS-2…6). The
  rendered stock-Refine admin surface + the browser E2E journey are the
  integration slice (#595).
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

## What's here

| Concern                                                  | File                          |
| -------------------------------------------------------- | ----------------------------- |
| Module wiring                                            | `events.module.ts`            |
| Admin HTTP surface (create + admin reads + transition)   | `events.admin.controller.ts`  |
| Public HTTP surface (event-page read + upcoming listing) | `events.public.controller.ts` |
| Transition command body DTO (`{ to }`)                   | `events.dto.ts`               |
| Authoring + guard + projection logic                     | `events.service.ts`           |
| Drizzle data access (insert, reads, state update)        | `events.repository.ts`        |

## Exported symbols

- **`EventsModule`** (`events.module.ts`) — registers the controllers +
  service + repository. Depends on the `@Global` `DatabaseModule` (`DRIZZLE_DB`)
  and `StorageModule` (`OBJECT_STORAGE`).
- **`EventsService`** (`events.service.ts`) — `create()` (007 EARS-1: folds the
  МСК wall-clock into one canonical instant via `mskLocalToInstant`, uploads the
  program PDF to object storage, inserts the `draft` aggregate + ordered speaker
  rows), `list()` (`EventAdminList`), `detail()` (`EventAdminDetail`),
  `transition()` (007 EARS-7: the closed-set guard — validates `current → to` via
  `canTransition`, refuses an invalid move with `InvalidTransitionError`, else
  persists the new state), and `publicEventPage()` (004 EARS-1: applies the
  visibility policy — `draft` → null → 404 — and projects the publish-safe
  allow-list `PublicEventPage`, mapping the internal `regalia`/`partnerRef` to
  the public `credentials`/`partners[].label`, omitting `programPdfUrl` when
  absent), and `listUpcoming()` (004 EARS-7: reads the `published`/`live` events
  at or after `now − AIR_WINDOW_MS`, nearest air date first, and projects the
  thin `UpcomingBroadcastCard` allow-list — name-only speakers, no
  operator/commercial field). Projects rows to the `@ds/schemas` read models,
  including `validTransitions` from the shared closed transition map.
- **`InvalidTransitionError`** (`events.service.ts`) — the guard's HTTP-agnostic
  refusal (`from`/`to`); the controller maps it to a 409 state conflict.
- **`EventsRepository`** (`events.repository.ts`) — the transactional insert
  (event + speakers land together or not at all), the list/detail reads,
  `updateState()` (the bare lifecycle-state write behind the guard),
  `findByIdOrSlug()` (resolves the public read by stable slug or id), and
  `listUpcoming()` (the `published`/`live`-at-or-after-cutoff read ordered nearest
  first, with speaker rows batched in one query — no N+1) over the `events` /
  `event_speakers` tables.

## Endpoints

| Route                                  | Access               | Command / read                                                         |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `POST /v1/admin/events`                | `platform_admin`     | `CreateEvent` (multipart: `payload` JSON + optional `programPdf` file) |
| `GET /v1/admin/events`                 | `platform_admin`     | `EventAdminList`                                                       |
| `GET /v1/admin/events/:id`             | `platform_admin`     | `EventAdminDetail`                                                     |
| `POST /v1/admin/events/:id/transition` | `platform_admin`     | `TransitionEvent` (EARS-7 closed-set guard; body `{ to }`)             |
| `GET /v1/public/events/:idOrSlug`      | **public** (no auth) | `PublicEventPage` (004 EARS-1) — `draft`/unknown → 404                 |
| `GET /v1/public/events` (`?upcoming`)  | **public** (no auth) | `UpcomingBroadcastCard[]` (004 EARS-7) — nearest first; empty → `[]`   |
