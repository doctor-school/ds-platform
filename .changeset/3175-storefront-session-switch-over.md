---
"@ds/api": patch
---

Storefront session switch-over (003 EARS-8 amended, #3175): a storefront session the storefront callback did not mint from a sign-in-host record — no Zitadel session id, or no storefront client — is refused on every read (auth hook, refresh, logout): it resolves to no subject, is deleted with a `SessionRevoked` (`force`), and is never refreshed. The Redis store parses records against their stored shape instead of casting, and `SessionService` no longer refreshes through the BFF client. The one-time revocation of every storefront session after the release is a runbook step in `operations/auth-operations.md`.
