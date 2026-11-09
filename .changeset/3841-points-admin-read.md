---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

The attention-points admin read API (025 EARS-45, #3841), `platform_admin` only, `Cache-Control: no-store`: `GET /v1/admin/points/fact-types` answers the fact-type catalog with its attribute schemas and predicates; `GET /v1/admin/points/rules` every rule and setting id with its active version and its version history; `GET /v1/admin/points/facts?personId=&cursor=&limit=` one person's fact journal with the evaluation traces as stored, newest first, cursor-paginated (`limit` 1–100, default 50); a malformed journal query is refused with problem `points-facts-query-invalid` (400). `@ds/schemas` adds `PointsFactTypeCatalogSchema`, `PointsRuleBookSchema` and the fact-journal page/query schemas.
