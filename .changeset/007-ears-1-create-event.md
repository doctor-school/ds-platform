---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

feat(events): 007 EARS-1 — CreateEvent authoring vertical (draft, МСК instant, program PDF → object storage)

Lands the write side of the Webinars event admin (feature 007, EARS-1 + EARS-8):

- `@ds/schemas` — the shared event-admin contracts: `EventLifecycleState`, the
  closed `LIFECYCLE_TRANSITIONS` map, the `mskLocalToInstant` МСК→instant fold,
  `CreateEventRequest`, and the `EventAdminDetail` / `EventAdminList` read models.
- `@ds/db` — the `events` + `event_speakers` tables and the
  `event_lifecycle_state` enum (Drizzle) + migration.
- `@ds/api` — `POST /v1/admin/events` (`CreateEvent`, multipart JSON + program
  PDF), `GET /v1/admin/events` (`EventAdminList`), `GET /v1/admin/events/:id`
  (`EventAdminDetail`), all classified `authenticated` / `platform_admin` /
  `fast-path` (EARS-8); plus a new object-storage module (S3/MinIO adapter +
  in-memory fake) for the program-PDF binary.
