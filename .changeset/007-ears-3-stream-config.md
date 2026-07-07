---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

feat(events): 007 EARS-3 — ConfigureStream (closed provider enum + embed reference)

Lands the stream-config handler of the Webinars event admin (feature 007, EARS-3 + EARS-8):

- `@ds/schemas` — the shared stream-config contracts: the closed
  `STREAM_PROVIDERS` enum (`rutube | youtube`), `ConfigureStreamRequest`, and the
  produced `StreamConfig` read model the 006 room consumes; `EventAdminDetail`
  now carries `streamConfig` (`null` until configured).
- `@ds/db` — the `stream_config` table (one row per event, `event_id` PK) and the
  `stream_provider` Postgres enum (Drizzle) + migration.
- `@ds/api` — `PUT /v1/admin/events/:id/stream` (`ConfigureStream`), classified
  `authenticated` / `platform_admin` / `fast-path` (EARS-8). The provider is an
  explicit member of the closed enum (an unknown provider is a 400 with no config
  recorded — never a URL to be sniffed); the write is an idempotent upsert so a
  wrong reference is correctable while `published` with no state reversal;
  configuring outside the `draft`/`published` pre-air window is a 409.

The admin stream-config **form** (stock Refine) + its browser E2E are the
integration slice (#595); this handler ships the backend command + its Vitest
e2e/unit.
