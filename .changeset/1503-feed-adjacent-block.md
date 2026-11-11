---
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": minor
"@ds/doctor": minor
"@ds/design-system": minor
"@ds/events-storefront": minor
---

«Смежные области» on the specialty feed (018 EARS-8, #1503). Breaking for `@ds/schemas` and `@ds/api-client`: the `SpecialtyFeed` block union gains the read-backed `adjacent` kind (last in the F-018-1 order), so an exhaustive switch over `kind` needs a new case; new `AdjacentAreas` schema `{ items: { specialty, direction: { id, slug, title }, feedHref }[] }`. The api adds `GET /v1/storefront/feed/{specialty}/adjacent` (public): adjacent specialties reached only through the managed direction ↔ specialty links and the direction adjacency relation, one entry per specialty through its highest-weight edge, never the chosen specialty or «Другое». `@ds/design-system`: `Link` gains a `chip` variant (a bordered pill link). `@ds/events-storefront`: new `./block` export re-exporting `BlockError` and `BlockRetry`. The doctor feed renders the block last: one chip per adjacent specialty opening that specialty's feed, a statement when there are none, and its own error + «Повторить».
