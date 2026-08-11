---
"@ds/api": patch
---

011 EARS-5/EARS-6 (#1211) — an IdP fault on the admin second-factor routes is now an honest `503`, never a bare `500`. `POST /v1/admin/auth/mfa/enroll/start`, `/mfa/enroll/verify` and `/mfa/verify` map `IdpUnavailableError` to `ServiceUnavailableException` with the same generic "temporarily unavailable" body `login` already answers with (#202, #1208). The TOTP seam fails loud by design, so an outage previously surfaced as a 500 — a third status beside the uniform 401 (EARS-7) and the 429, reachable only by a caller already holding a live pending authentication. An outage is still not a failed attempt: it writes no `auth.mfa.failure` row and spends no lockout unit, so a downed IdP cannot lock out an operator who keeps retrying.
