---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
---

A congress desk registrar is bound to one event (044 EARS-38, #2384). The new
`event_role_grants` table (migration 0039, audited by the 010 trigger) binds a
user's `event-registrar` role to exactly one event; the roster route
`GET /v1/admin/events/:idOrSlug/roster` becomes an `auth_check: policy` row whose
handler admits a registrar only for the bound event — another event, an unknown
one, or a registrar with no binding row is refused with 403 — while the platform
administrator is not limited. `GET /v1/admin/auth/session` now also returns
`eventGrants` (role, event id, event slug) for the admin navigation. `@ds/db`
exports `findEventGrant` / `listEventGrantsBySub`; until the grants screen
(#2378) the tech lead inserts a binding by hand (runbook in
`apps/api/src/registration/README.md`).
