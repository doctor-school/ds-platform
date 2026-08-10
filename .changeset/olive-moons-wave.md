---
"@ds/api": patch
---

011 EARS-3 (#1208 review) — an IdP fault during admin primary auth is now an honest `503`, never a bare `500`. `AdminAuthController.login` maps `IdpUnavailableError` to `ServiceUnavailableException` with a generic "temporarily unavailable" body, matching the portal's #202 mapping. The unmapped throw was reachable only after a valid password on a `platform_admin`, so its 500 was a membership oracle against the otherwise uniform 401. The Zitadel session created by the password check is also terminated (fail-soft) on every throw path after it, so a persistent fault no longer leaks one live IdP session per login attempt.
