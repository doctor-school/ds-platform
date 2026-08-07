---
"@ds/schemas": minor
"@ds/api": major
---

011 EARS-1/2/3/10 — dedicated `__Host-ds_admin_session` tier, `role → mfa_required` policy, pending-auth.

`@ds/schemas` (minor, additive): `AdminAuthStateSchema`, `AdminLoginRequestSchema`, `AdminLoginResponseSchema`, `AdminLogoutResponseSchema` and their inferred types.

`@ds/api` (major, breaking runtime semantics): admin routes (`/v1/admin/**`) now authenticate **exclusively** via `__Host-ds_admin_session`. The doctor-portal `__Host-ds_session` — which authenticated the admin surface in the ADR-0004 design §3.2 wave-1 posture — is refused there as unauthenticated (`401`, plus an `auth.session.rejected` audit row), and state-changing admin endpoints additionally require the CSRF double-submit header. Primary auth at `POST /v1/admin/auth/login` issues no session: a `platform_admin` receives a short-lived pending-auth reference and the required next step. Portal session behaviour is unchanged.
