---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

048 materials feed (#3513): the two anonymous reads — `GET /v1/public/feed?cursor=&limit=` (cards of the common `FeedCardSchema` union, newest first with ties by id, microsecond-exact keyset cursor, `limit` 1–24 default 12, `nextCursor` `null` at the end, read from `feed_entries` joined only to the column's expert and the partner organisation) and `GET /v1/public/materials/{slug}` (`PublicMaterialSchema`; the same `404` for draft, unknown and non-public). A column is shown only while its expert is published, its card source line built at the read by the new `expertShortName` («Фамилия И. О.»); `partner` follows the 032 organisation display predicate and never hides a material.
