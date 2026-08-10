---
"@ds/api": patch
---

011 EARS-3 (#1208) — the registered-TOTP-factor read now uses the management-v1 search RPC (`POST /management/v1/users/{id}/auth_factors/_search`). The plain `GET …/auth_factors` the adapter previously called is not routed by the deployed Zitadel and answers `404` for **every** user, and the adapter's `404 → false` carve-out turned that into "this admin has no second factor" — so an admin with a READY TOTP factor was re-routed into `mfa_pending_enrollment` on every login. With the search hop an absent factor is an empty `result[]`, so the carve-out is gone: every non-2xx (404 included) now raises `IdpUnavailableError` rather than resolving a permissive `false`.
