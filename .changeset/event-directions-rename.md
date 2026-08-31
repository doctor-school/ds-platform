---
"@ds/db": major
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": major
"@ds/admin": major
---

Complete the ADR-0016 §5 `topics` → `directions` rename through the 012 EARS-11
event join (#1645). The table is now `event_directions` with a `direction_id`
column (true rename — every retained row, id, version and audit lineage
survives), the admin surface is `/v1/admin/event-directions`, and the public
traversal answers `GET /v1/public/events/:idOrSlug/directions` and
`GET /v1/public/directions/:idOrSlug/events`.

Breaking: the old `event-topics` / `…/topics` routes and the `EventTopic*` /
`PublicTopicSummary*` contract exports are gone with no alias — the rename has
no consumers outside this repo. Behaviour, pagination, problem shapes and
visible RU copy are unchanged.
