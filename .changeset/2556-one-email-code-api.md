---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

One email code (003 EARS-41/34/23): `/verify`, `/login/otp` and the new doctor-host `/v1/storefront/doctor/verify` accept one emailed code whatever the account state — an unverified address is verified by it and signed in (session cookie set), its pre-verification password replaced by the registration step's or invalidated on sign-in by code. A registration onto an existing address sends a link-free code mail instead of the account-exists notice; the ticked consents the account lacks are recorded only after the code is accepted, never overwriting a held one. `MAILER_PORTAL_BASE_URL` is retired — no mail carries a portal link.
