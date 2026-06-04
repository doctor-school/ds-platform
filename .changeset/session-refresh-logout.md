---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): #88 session refresh rotation + logout (003 F4)

Implements EARS-9 (single-use refresh rotation; RFC-6819 reuse → chain
invalidation + session revoke + `RefreshReuseDetected`) and EARS-10 (logout →
server-side session DELETE + `__Host-` cookie cleared + `SessionRevoked`), per
003-design §3 and ADR-0001 §6/§7.

`@ds/api`: `IdpClient.refreshTokens` (IdP-owned reuse detection), `SessionStore`
`rotate` + `delete`, `SessionService.refresh` / `.logout`, an `AuthAuditLog`
seam (`AUTH_AUDIT`, in-memory until the F6 durable writer), and the
`doctor_guest`-protected `POST /v1/auth/refresh` + `POST /v1/auth/logout` routes.

`@ds/schemas`: adds the token-free `RefreshResponse` (`refreshed`) and
`LogoutResponse` (`logged_out`) contracts.
