---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

007 EARS-14 (#4305): `GET /v1/admin/events` sorts by one column (`sort` = `startsAt` | `title` | `school` | `state`, `dir` = `asc` | `desc`) and filters by lifecycle `state` and a Moscow-day start period (`startsFrom` / `startsTo`, inclusive); the `q` search also matches the school. A query without `sort` keeps the alphabetical title order the pickers read, and the query stays strict.
