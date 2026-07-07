---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

feat(events): 005 EARS-1 — logged-in one-tap RegisterForEvent command + record

Lands the foundation of feature 005's write side (realizes US-1, US-3): the
`doctor_guest`-authenticated `RegisterForEvent` command, the durable registration
record, and the per-user `EventRegistrationState` read that flips to `registered`
the moment the write lands. These are the **first authenticated `doctor_guest`**
endpoints in the webinar domain.

- `@ds/api` — new `registration` module. `POST /v1/events/:idOrSlug/registration`
  (`RegisterForEvent`) records a registration against the authenticated doctor's
  account in **one action** — no confirmation round-trip — for a `published`
  (upcoming) or `live` event, and returns the registered `EventRegistrationState`
  so the event page flips immediately. `GET /v1/events/:idOrSlug/registration`
  returns the caller's own `{ registered, registeredAt? }` state (private, never a
  shared cache). Both carry the **EARS-10** endpoint-authz classification
  `authenticated` / `doctor_guest` / `fast-path`: an unauthenticated caller is
  refused (401) and any non-`doctor_guest` role (403) — never a silent success.
  Gating reads the single `EventLifecycleState` (007, read-only): a
  non-`published`/`live` state is a 409, a missing event a 404.
- `@ds/db` — new `registrations` table (`id, user_id → users`, `event_id →
events`, `registered_at`), migration `0007_registrations.sql`. No cancelled
  state in wave 1 (owner decision).
- `@ds/schemas` — new `EventRegistrationState` read model + `REGISTRABLE_EVENT_STATES`
  / `isRegistrable` gating SSOT (the API contract shared with the portal via the SDK).

The one-registration invariant (`UNIQUE (user_id, event_id)` + idempotent upsert,
EARS-3), the terminal `audit_ledger` row (EARS-8), the broader per-user reads
(EARS-4/6), the guest-through-auth event-context carry (EARS-2), and the
ended/archived gating detail (EARS-9) are sibling handlers. Built and E2E-driven
against seeded fixture events until feature 007 delivers authoring/transitions
(tracked seam, parent #564).
