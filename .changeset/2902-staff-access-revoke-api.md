---
"@ds/api": minor
"@ds/db": minor
"@ds/api-client": minor
---

Staff access revocation (047 EARS-7…EARS-9): `POST /v1/admin/staff-access/revocations` (`platform_admin`, live revalidation, `stepUp`) takes `{userId, role, eventId?}`, ends every admin session and pending admin sign-in of the person, removes the role at the IdP (and the IdP grant itself when it was the grant's last role), deletes the event binding and appends the `auth.role.revoked` row; it answers `204`. Refusals: `403 REVOKE_SELF_PLATFORM_ADMIN` (the caller's own platform-administrator role), `409 REVOKE_ALREADY_COMPLETE` (a role the person does not hold — nothing changed), `401 STEP_UP_REQUIRED`, `400`, and `503` when the IdP fails after the sessions were already ended. `@ds/db` adds the event-binding delete helper; the SDK is regenerated.
