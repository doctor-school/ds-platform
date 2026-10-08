---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

Events storefront wave 2 (#2028), the read contract of the one feed view on both hosts: `GET /v1/public/events?timeframe=…` accepts the horizon `from`/`to` of the one listing codec (the cursor stays for other callers and never combines with it) and echoes `horizon { from, to, nextTo }`; every Academy listing card carries its event `kind`, attendance `format` and the colleagues' `signUpCount`; the new `GET /v1/public/events/live` serves the Academy «Идёт сейчас», and `GET /v1/storefront/doctor/events/live` now returns a list of strips (`[]` when nothing is live) instead of one strip or `null` — both from one live resolution parameterised by audience. The horizon envelope of both feed reads (Academy `horizon { … }`, doctor top level) gains `nextFrom` — «Прошедшие» widens backward to an older `from` while «Будущие» keeps widening `to` via `nextTo` — and `remaining`, the count of matching events beyond the extent that «Показать ещё» can still reach. A doctor feed card of an ended event carries the same 014 `recording` projection the Academy past card carries, so both hosts apply one playability rule.

The Academy listing `counts` gain `upcomingSchools` — the distinct schools among the upcoming listing-eligible events — which the Academy feed head states as «N эфиров · M школ».
