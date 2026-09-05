---
"@ds/api": patch
---

012 EARS-12 — fix a non-terminating public page loop on the event-ordered
relationship traversals. `GET /v1/public/projects/:key/events` and
`GET /v1/public/directions/:key/events` encoded their keyset cursor from the
millisecond-precision `Date` node-postgres returns, while `events.starts_at`
keeps microseconds; the truncated cutoff re-matched the row that issued the
cursor, so a caller paging with a bounded `limit` was served the same row
forever. The cursor now carries the instant as Postgres renders it.
