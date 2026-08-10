---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

011 EARS-4/5 — forced-enrollment gate + self-serve TOTP enrollment.

A `platform_admin` who completes primary auth with no registered TOTP factor is
now held in `mfa_pending_enrollment`: the API refuses every admin route for that
state and admits only the two enrollment endpoints, and the admin app renders the
enrollment screen — QR, the same secret as selectable text, and a six-digit code
field. A correct first code registers the factor, appends a secret-free
`auth.mfa.enrolled` row, and upgrades the pending authentication in place into
`__Host-ds_admin_session`, so the operator lands in admin with no second login.

Additive: `POST /v1/admin/auth/mfa/enroll/{start,verify}`, the `IdpPort` TOTP
register/verify seam, the enrollment schemas, and the `pending-auth`
endpoint-authz access class.
