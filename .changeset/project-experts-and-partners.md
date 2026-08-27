---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

Project↔expert and project↔partner relationships (012 EARS-9 / EARS-10). A project now carries its people and its sponsors as first-class curated links: experts are listed with a `curator | member` role under an at-most-one-active-curator invariant (a published project is never committed with zero or two curators), and the curator seat is handed over by the atomic, version-checked `POST /v1/admin/projects/:id/replace-curator` rather than by a second create. Partners carry `isPrimary` as an ordinary row attribute — a second active primary is refused with 409 `RELATIONSHIP_CONFLICT` and zero mutation — and `PublicProjectSummary.primaryPartner` is now populated on every public route that emits it, through one shared builder instead of a copy per vertical. Admin surfaces: `/v1/admin/project-experts` and `/v1/admin/project-partners` (list filtered by either endpoint, create, patch, retire, restore); public reads: `/v1/public/projects/:idOrSlug/{experts,partners}`, `/v1/public/experts/:idOrSlug/projects`, `/v1/public/partners/:idOrSlug/projects`. Two new admin panels are embedded bidirectionally on the project, expert and partner detail pages.
