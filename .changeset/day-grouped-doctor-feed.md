---
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/design-system": minor
"@ds/api": minor
"@ds/doctor": minor
---

019 EARS-3 — the day-grouped, specialty-targeted doctor events feed.

Additive across the chain and breaking nowhere. `@ds/schemas` gains the
`doctor-events-feed` contract plus the ONE query codec both hosts decode with;
`@ds/api` serves `GET /v1/storefront/doctor/events` and `@ds/api-client`
regenerates against it; `@ds/design-system`'s `EventList` widens with the
optional `tenseControl` / `paginationMode: "none"` / `footer` props a host
reading a single tense over a bounded horizon needs (every existing caller
keeps its current behaviour); `@ds/doctor` gains the `/events` route.
