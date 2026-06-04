---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): #89 password reset (003 F5)

Implements EARS-11 (enumeration-resistant reset initiate → Zitadel
forgot-password code flow; identical response whether or not the identifier
exists) and EARS-12 (complete → IdP sets the new password against the reset
code, every existing session of the subject is revoked, `PasswordResetCompleted`
emitted), per 003-design §6/§10 and ADR-0001 §6/§7.

`@ds/api`: `IdpClient.requestPasswordReset` / `completePasswordReset` (fake +
Zitadel User v2 adapter, both enumeration-safe / fail-closed), a new
`SessionStore.deleteBySub` global-revocation primitive backed by a `sub → sids`
index (in-memory + Redis), `SessionService.revokeAllForSub`, and the public
`POST /v1/auth/password/reset` (`@BotProtected`) + `POST
/v1/auth/password/reset/complete` routes.

`@ds/schemas`: adds the `PasswordResetRequest`/`PasswordResetResponse`
(`reset_requested`) and `PasswordResetCompleteRequest`/`PasswordResetCompleteResponse`
(`reset_completed`) contracts.
