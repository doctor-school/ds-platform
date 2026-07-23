---
"@ds/api": minor
---

003 EARS-34/35: enumeration-safe recovery for email-unverified accounts (#1131).

- EARS-34: a login-by-email-code request for an existing but email-unverified account no longer silently dead-ends. Instead of arming the Zitadel `otp_email` login challenge (which Zitadel never sends to an unverified email), the BFF re-issues the verify-to-sign-in code and dispatches the branded, code-only verification email out-of-band (fire-and-forget off the response path). The synchronous response stays byte-identical in status, body, and timing across nonexistent / existing-unverified / existing-verified identifiers (no existence or verification oracle).
- EARS-35: a successfully completed password reset now marks the account's email verified (proof-of-mailbox-ownership), mirrored onto the users row, closing the stuck-unverified state through the existing recovery path. Idempotent, and no state is mutated before a valid reset token.
