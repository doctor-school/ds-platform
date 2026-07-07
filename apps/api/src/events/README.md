# `events` — 007 event-admin authoring surface (write side)

The authoring vertical of the Webinars epic (feature 007) — the **write model**
of the webinar aggregate the rest of the epic reads projections of. This
iteration (EARS-1) lands `CreateEvent` plus the two admin reads; the edit /
stream-config / lifecycle-transition commands + the server-side transition guard
are sibling handlers (EARS-2…7). The rendered stock-Refine admin surface + the
browser E2E journey are the integration slice (#595).

All routes are classified `access: authenticated`, `required_roles:
platform_admin`, `auth_check: fast-path` (EARS-8, ADR-0001 §2) — the global
`AuthzGuard` refuses `doctor_guest` and public callers fail-closed. The DTO SSOT
is `@ds/schemas` (`packages/schemas/src/events`); the aggregate + speaker rows
live in Postgres via `@ds/db`; the program-PDF binary lives in object storage
(the `storage` module), only its reference on the aggregate.

## What's here

| Concern                                            | File                         |
| -------------------------------------------------- | ---------------------------- |
| Module wiring                                      | `events.module.ts`           |
| HTTP surface (multipart create + admin reads)      | `events.admin.controller.ts` |
| Authoring logic (МСК fold, PDF upload, projection) | `events.service.ts`          |
| Drizzle data access (transactional insert, reads)  | `events.repository.ts`       |

## Exported symbols

- **`EventsModule`** (`events.module.ts`) — registers the controller +
  service + repository. Depends on the `@Global` `DatabaseModule` (`DRIZZLE_DB`)
  and `StorageModule` (`OBJECT_STORAGE`).
- **`EventsService`** (`events.service.ts`) — `create()` (EARS-1: folds the МСК
  wall-clock into one canonical instant via `mskLocalToInstant`, uploads the
  program PDF to object storage, inserts the `draft` aggregate + ordered speaker
  rows), `list()` (`EventAdminList`), `detail()` (`EventAdminDetail`). Projects
  rows to the `@ds/schemas` read models, including `validTransitions` from the
  shared closed transition map.
- **`EventsRepository`** (`events.repository.ts`) — the transactional insert
  (event + speakers land together or not at all) and the list/detail reads over
  the `events` / `event_speakers` tables.

## Endpoints (all `platform_admin`, fast-path)

| Route                      | Command / read                                                         |
| -------------------------- | ---------------------------------------------------------------------- |
| `POST /v1/admin/events`    | `CreateEvent` (multipart: `payload` JSON + optional `programPdf` file) |
| `GET /v1/admin/events`     | `EventAdminList`                                                       |
| `GET /v1/admin/events/:id` | `EventAdminDetail`                                                     |
