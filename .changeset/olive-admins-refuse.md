---
"@ds/api": minor
---

`POST /v1/admin/auth/login` no longer answers a PARTIAL identity-service fault
with a 503. Every IdP call after the password check (the OIDC exchange, the
EARS-3 factor read) is reached only by a valid credential pair on a
`platform_admin`, so a distinct status there was returned for exactly one input
class — a membership oracle the uniform refusal exists to deny. That span now
returns the same uniform 401 «invalid credentials» as a wrong password, and the
outage is recorded in the operator log rather than in the response.

The FULL-outage carve-out is unchanged: when the password check itself is down —
which every caller reaches, so the answer discriminates nobody — the route still
returns the honest 503 «temporarily unavailable», and the admin login screen
still renders its outage alert (#1220). The 503 posture of the second-factor
routes (#1211) is untouched.

No export, signature or payload shape changes; the admin app needs no update.
