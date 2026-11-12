---
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/api": minor
---

Public project reads of the Academy (030 EARS-8, EARS-9, EARS-13, #3505). The api adds `GET /v1/public/projects` (catalog cards: running and soon first, then completed, each in the operator's order; the outputs line from the distinct kinds of the results; the investor projected by 032 EARS-5; no kind), `GET /v1/public/projects/scale` (`{ projects, partners, broadcasts, firstBroadcastYear }`, partners being the 032 EARS-12 count), `GET /v1/public/projects/{idOrSlug}` (hero fields, the curator's display name only, counts, since-year, organisations, `investorPlaceOpen`) and `…/results` (results in order); a draft, retired, non-public or unknown project answers `404` alike. New `@ds/schemas` contract `public-project.ts`; `PublicProjectSummary` gains the required `stage`. `scale` and `order` are reserved project slugs.
