---
"@ds/schemas": major
"@ds/api": minor
"@ds/api-client": minor
"@ds/events-storefront": minor
"@ds/portal": minor
"@ds/doctor": minor
---

«Прошедшие» on both storefronts pages by count, not by 14-day windows (019 «Amendment — 2026-10-12», #2768): the bare «Прошедшие» read of `GET /v1/public/events?timeframe=past` and `GET /v1/storefront/doctor/events?tense=past` opens on the 10 most recent past events that match the facets, however old, and every `nextFrom` takes in the next 10 older ones (the last step the remainder), in whole МСК days; the control reads «Показать ещё 10 (осталось N)». «Будущие» keeps its day horizon and «Показать ещё N из M». The head subline «N эфиров · M школ» counts the open tab — on «Прошедшие» the past events and their schools — and is not rendered for a tab with no events. The month view on «Прошедшие» without an explicit month opens on the month of the latest past event under the facets.

**Breaking:**

- `@ds/schemas`: `PublicEventListingCountsSchema` requires `pastSchools`, the distinct schools among the past listing-eligible events; `DOCTOR_EVENTS_FEED_PAST_STEP_EVENTS` (10) is the «Прошедшие» step.
