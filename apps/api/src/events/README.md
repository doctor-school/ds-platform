# `events` — 007 event-admin authoring surface (write side)

The authoring vertical of the Webinars epic (feature 007) — the **write model**
of the webinar aggregate the rest of the epic reads projections of. EARS-1 lands
`CreateEvent` plus the two admin reads; **EARS-7** lands the single closed-set
lifecycle state machine — the server-enforced transition guard. The edit /
stream-config commands and the four **named** transition commands with their
product side-effects + `audit_ledger` rows are sibling handlers (EARS-2…6). The
rendered stock-Refine admin surface + the browser E2E journey are the
integration slice (#595).

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

All routes are classified `access: authenticated`, `required_roles:
platform_admin`, `auth_check: fast-path` (EARS-8, ADR-0001 §2) — the global
`AuthzGuard` refuses `doctor_guest` and public callers fail-closed. The DTO SSOT
is `@ds/schemas` (`packages/schemas/src/events`); the aggregate + speaker rows
live in Postgres via `@ds/db`; the program-PDF binary lives in object storage
(the `storage` module), only its reference on the aggregate.

## What's here

| Concern                                             | File                         |
| --------------------------------------------------- | ---------------------------- |
| Module wiring                                       | `events.module.ts`           |
| HTTP surface (create + admin reads + transition)    | `events.admin.controller.ts` |
| Transition command body DTO (`{ to }`)              | `events.dto.ts`              |
| Authoring + guard logic (МСК fold, PDF, transition) | `events.service.ts`          |
| Drizzle data access (insert, reads, state update)   | `events.repository.ts`       |

## Exported symbols

- **`EventsModule`** (`events.module.ts`) — registers the controller +
  service + repository. Depends on the `@Global` `DatabaseModule` (`DRIZZLE_DB`)
  and `StorageModule` (`OBJECT_STORAGE`).
- **`EventsService`** (`events.service.ts`) — `create()` (EARS-1: folds the МСК
  wall-clock into one canonical instant via `mskLocalToInstant`, uploads the
  program PDF to object storage, inserts the `draft` aggregate + ordered speaker
  rows), `list()` (`EventAdminList`), `detail()` (`EventAdminDetail`),
  `transition()` (EARS-7: the closed-set guard — validates `current → to` via
  `canTransition`, refuses an invalid move with `InvalidTransitionError`, else
  persists the new state). Projects rows to the `@ds/schemas` read models,
  including `validTransitions` from the shared closed transition map.
- **`InvalidTransitionError`** (`events.service.ts`) — the guard's HTTP-agnostic
  refusal (`from`/`to`); the controller maps it to a 409 state conflict.
- **`EventsRepository`** (`events.repository.ts`) — the transactional insert
  (event + speakers land together or not at all), the list/detail reads, and
  `updateState()` (the bare lifecycle-state write behind the guard).

## Endpoints (all `platform_admin`, fast-path)

| Route                                  | Command / read                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `POST /v1/admin/events`                | `CreateEvent` (multipart: `payload` JSON + optional `programPdf` file) |
| `GET /v1/admin/events`                 | `EventAdminList`                                                       |
| `GET /v1/admin/events/:id`             | `EventAdminDetail`                                                     |
| `POST /v1/admin/events/:id/transition` | `TransitionEvent` (EARS-7 closed-set guard; body `{ to }`)             |
