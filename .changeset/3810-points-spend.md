---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/api-client": minor
---

The attention-points spend slice (025 EARS-13, 14, 17, 18, 19, 21, 26, 35, 41, EARS-2 read side, #3810): migration 0061 adds the price list (`points_prices`, any item kind, mode open/advance/threshold, Pul price) and the `points_reserves` / `points_obligations` hold projections. The engine gains reserve / settle / release effects with per-obligation netting, the `concurrentOpen` reserve limit, real `item.*` predicates and a write-free `quote`. New endpoints: admin `PUT /v1/admin/points/prices/:itemRef` (refuses lesson / module / НМО-accredited items; advance refused like threshold until #3811) and doctor `GET /v1/me/points/gating/:itemRef` (a decision for every valid request: `open` / `reserve` / `short` / `blocked`). The 005 registration reports `registration.created` in its transaction (a refusal fails the sign-up closed with a 4xx naming the problem); the no-show sweep releases holds; attendance settles them. The public 044 congress intake stays out of the spend path: a priced event is refused with its generic refusal (044 EARS-41).
