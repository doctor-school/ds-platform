---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/api-client": minor
---

Staff access (047 EARS-1…EARS-6, EARS-8, EARS-9 grant half): `GET /v1/admin/staff-access` lists every holder of a grantable staff role, one row per person, role and event, reading every page of the IdP grant search; `POST /v1/admin/staff-access/grants` (`platform_admin`, live revalidation, `stepUp`) finds or creates the account, adds the role to its existing IdP grant, writes the event binding and the `auth.role.granted` row, and returns a one-time temporary password for a new account or one without a password; an existing account whose email was never verified is refused with `409 STAFF_GRANT_EMAIL_UNVERIFIED` and nothing changed. Grants for one email are serialized under a per-email advisory lock. A stale second factor answers `STEP_UP_REQUIRED` with `stepUpUrl: "/mfa/challenge?mode=reverify"`; `POST /v1/admin/auth/mfa/reverify` refreshes the session's second factor in place and appends `auth.step_up.*` rows. `@ds/schemas` exports the staff-access and reverify contracts; `@ds/db` adds the event-grant list and insert helpers.
