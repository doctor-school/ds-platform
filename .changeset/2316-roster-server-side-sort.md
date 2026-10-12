---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

Congress roster sort (044 EARS-22, narrowed by EARS-37): `GET /v1/admin/events/:idOrSlug/roster` accepts `sort` (`fullName`, `specialty`, `city`, `phone`, `registeredAt`, `presence`) and `dir` (`asc`/`desc`), composable with `q`, the presence filter and the page. Text columns order under the Russian collation with empty cells last, the phone by its normalised digits, `presence` by the mark of `attendanceDay` (required with that key, 400 otherwise); without `sort` the order stays registration date ascending. `@ds/schemas` exports `CONGRESS_ROSTER_SORT_KEYS`, `CONGRESS_ROSTER_SORT_DEFAULT` and the sort key/direction schemas.
