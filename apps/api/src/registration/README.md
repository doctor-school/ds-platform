# `registration` — webinar event registration (005 write side + per-user read)

The webinar-registration module — the **write side** of feature 005 (Event
registration & «мои события»), plus the per-user registration-state read. These
are the **first authenticated `doctor_guest`** endpoints in the webinar domain
(004 added the public ones; 007 the `platform_admin` authoring ones).

**EARS-1** lands the foundation of the write side:

- `RegisterForEvent` (`POST /v1/events/:idOrSlug/registration`) — an
  authenticated doctor activates «Участвовать» on a `published` (upcoming) or
  `live` event and a registration is recorded against their account in **one
  action** (no confirmation round-trip). The response is the registered
  `EventRegistrationState`, so the event page flips to the registered state
  immediately.
- `EventRegistrationState` read (`GET /v1/events/:idOrSlug/registration`) — the
  caller's own `{ registered, registeredAt? }` state; it flips from
  `{registered:false}` to `{registered:true, registeredAt}` the moment the write
  lands. Per-user and private (never a shared-cacheable projection), returning
  only the caller's own state.

Both carry the **EARS-10** cross-cutting classification `authenticated` /
`doctor_guest` / `fast-path` in the endpoint-authz matrix (ADR-0001 §2): the
global `AuthzGuard` refuses an unauthenticated caller (401) and any
non-`doctor_guest` role (403) before the handler runs — never a silent success.
Gating reads the single `EventLifecycleState` (owned by 007, read-only): a
non-`published`/`live` state is a 409, a missing event a 404.

**EARS-6** adds the `MyEvents` «мои события» read:

- `MyEvents` (`GET /v1/me/events`) — the authenticated doctor's registered
  **upcoming** events (`published`/`live`, future or currently airing), ordered
  **nearest `startsAt` first**, each `{ eventId, slug, title, school, startsAt,
state }`. Feeds the portal «мои события» Предстоящие tab (`/account/events`); an
  empty result is a valid `[]` (the surface renders the canvas empty-state). The
  temporal window mirrors the 004 upcoming listing (`starts_at ≥ now −
AIR_WINDOW_MS`), with the lifecycle STATE the primary filter — `ended`/`archived`
  registrations never list (EARS-6). The read returns ONLY the caller's own
  registrations, never another doctor's (EARS-10); a just-registered event appears
  on the next read (EARS-7).

## Exported symbols

- `RegistrationModule` — the Nest module (both controllers + service +
  repository).
- `RegistrationService` — the `RegisterForEvent` command, the
  `EventRegistrationState` read, and the `MyEvents` list; resolves the acting
  doctor's `user_id` from the authenticated Zitadel `sub` (003 mirror) and the
  target event from its slug/id (007 read model). Domain errors:
  `EventNotRegistrableError` (→ 409), `RegistrationEventNotFoundError` (→ 404),
  `UnknownSubjectError` (→ 401).
- `RegistrationController` — the `/events/:idOrSlug/registration` write + state
  read; `MyEventsController` — the `/me/events` list (`/me` path prefix, the
  caller's own resources). Both `doctor_guest`-authenticated (EARS-10).
- `RegistrationRepository` — Drizzle access: writes the `registrations` record;
  reads `events` (007) and `users` (003) read-only, including the `MyEvents` join.

**EARS-3** layers the one-registration invariant on top of that record:

- The DB `UNIQUE (user_id, event_id)` constraint (migration
  `0008_registrations_unique.sql`, which dedups any pre-existing duplicate rows
  keeping the earliest `registered_at` before adding the constraint) is the
  structural guard — at most one registration per `(doctor, event)` (ADR-0003
  §5), not client discipline.
- `RegisterForEvent` is an idempotent `INSERT … ON CONFLICT (user_id, event_id)
DO NOTHING` upsert + read-back: a repeat via **any** path (one-tap,
  guest-through-auth, «мои события» re-entry) returns the existing row and
  creates no duplicate; the insert-race resolves on the constraint.
- On the **first insert only**, one terminal `audit_ledger` row
  (`webinar.registration.created`) is appended in the same transaction — the
  durable `DoctorRegisteredForEvent`; an idempotent repeat emits none (the
  exactly-one-then-none invariant, EARS-3/EARS-8; design §5).

## Boundaries & tracked seams

- The durable `registrations` record shape is `(id, user_id, event_id,
registered_at)` — no cancelled state in wave 1 (owner decision). The
  `EventRoster` (the roster's membership basis, consumed by 006 + the wave-2
  sponsor report) is "every registration row for the event" — its read model is
  the sibling **EARS-8** handler on top of this record.
- The broader per-user reads — the event-page overlay that leaves 004's public
  cache untouched (**EARS-4**), `MyEvents` / «мои события» (**EARS-6**) — and the
  guest-through-auth event-context carry (**EARS-2**) build on this command.
- **Seam → feature 007.** Registration gating reads the `EventLifecycleState`
  owned by 007; until 007's authoring/transitions land, the surface is built and
  E2E-driven against **seeded fixture events** in each lifecycle state (tracked on
  parent #564). "Done against the real dependency" = registration gates on events
  authored + transitioned through 007, not only seeds.
