---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/admin": minor
---

007 EARS-14 (#4305): `GET /v1/admin/events` sorts by one column (`sort` = `startsAt` | `title` | `school` | `state`, `dir` = `asc` | `desc`) and filters by lifecycle `state` and a Moscow-day start period (`startsFrom` / `startsTo`, inclusive); the `q` search also matches the school. A query without `sort` keeps the alphabetical title order the pickers read, and the query stays strict.

The admin «Мероприятия» list runs on the shared admin list: it opens newest start date first, sorts by «Название», «Школа / серия», «Дата и время (МСК)» or «Статус» in either direction, filters instantly by the search, the state and a «Дата проведения» period as removable chips with «Сбросить всё», keeps the whole view in the address, opens an event from its row, and shows record cards with a «Сортировка» select on a phone.
