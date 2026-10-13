---
"@ds/schemas": major
"@ds/api": minor
"@ds/events-storefront": major
"@ds/portal": minor
"@ds/doctor": minor
---

«Будущие» on both storefronts pages by count, not by a 14-day horizon (019 «Amendment — 2026-10-12», #2884): the bare «Будущие» read of `GET /v1/public/events` and `GET /v1/storefront/doctor/events` opens on the 10 nearest upcoming events that match the facets, however far ahead, and every `nextTo` takes in the next 10 later ones (the last step the remainder), in whole МСК days — a day the tenth event shares with later ones is served whole. With 10 or fewer matching events the whole tense is served and no «Показать ещё» renders. Both tenses now read «Показать ещё N (осталось M)». A day picked in the month view beyond the current «Будущие» extent widens it to take that day in.

**Breaking:**

- `@ds/schemas`: `DOCTOR_EVENTS_FEED_HORIZON_DAYS`, `DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS` and `DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS` are removed; `DOCTOR_EVENTS_FEED_PAST_STEP_EVENTS` is renamed `DOCTOR_EVENTS_FEED_STEP_EVENTS` (10), the step of both tenses.
- `@ds/events-storefront`: `FEED_COPY.feed.showMorePast` is removed — `showMoreOf` is the one «Показать ещё N (осталось M)» label of both tenses.
