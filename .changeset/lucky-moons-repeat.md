---
"@ds/schemas": minor
"@ds/api": minor
---

011 EARS-9/11/13 (#1193) — the admin tier's audit trail and endpoint-authz floor are now verified end to end, and the operator factor-removal endpoint `DELETE /v1/admin/users/:id/mfa` ships with them.

- **EARS-13 (additive endpoint + DTO).** A `platform_admin`-only, high-stakes route that removes another admin's registered TOTP factor, admitted only on the caller's **own current TOTP code** in the request (route-local fresh-possession proof — the general step-up mechanism is unbuilt, so the matrix row carries the honest `step_up: false`). It emits the canonical `auth.mfa.reset` row naming the operator in `by_admin`, and returns the target to forced enrollment. The `@ds/schemas` factor-removal request/response shapes are additive.
- **EARS-9 (audit trail).** Every admin-session/MFA lifecycle event appends exactly one terminal `audit_ledger` row under **exactly** the canonical ADR-0001 design §7.3 wire id its domain event maps to, carrying `tier: "admin"` so admin rows stay separable from the doctor portal's on the shared `auth.session.*` / `auth.login.*` classes. `auth.session.rejected` — the one id 011 adds, a new event inside the existing `auth.session` class — is now registered upstream by a forward-reference row in the ADR-0001 design §7.3 taxonomy table (EN + RU).
- **EARS-11 (raised floor).** Every admin route is classified `access: authenticated` + `required_roles: platform_admin` on top of an MFA-verified admin session; a session carrying the role but not a verified second factor is refused on **all** of them — never downgraded, never partially served. The 007 admin-events commands keep their shape.
