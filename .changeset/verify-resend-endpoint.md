---
"@ds/schemas": minor
"@ds/api": minor
---

Resend registration verification code (#319, EARS-25): `POST /v1/auth/verify/resend`.

- **New endpoint** — `POST /v1/auth/verify/resend` takes `{ identifier }` (the email) and re-issues the Zitadel `otp_email` registration verification code **enumeration-safely**: a code is re-issued only for an existing, **unverified** registrant; an unknown identifier or an already-verified one is a silent no-op with an identical ack (`resend_requested`), status, and timing (EARS-16). It is `@Public @RateLimited @TimingEqualized @BotProtected("verify-resend")` like the other abuse-prone unauthenticated surfaces, and appends an `otp.sent` ledger row (EARS-18) only when a code is actually issued — so the ledger is not itself an existence oracle. Lets a registrant whose first code did not arrive re-request it from the existence-agnostic `/verify` screen (EARS-24) without re-typing the password.
- **New `@ds/schemas` exports** — `VerifyResendRequestSchema` / `VerifyResendRequest` and `VerifyResendResponseSchema` / `VerifyResendResponse` (loose `{ identifier }` contract, like `PasswordResetRequestSchema`).
- **New IdP port method** — `IdpClient.resendEmailVerification(identifier)` resolves the identifier → Zitadel `sub` internally (mirroring `requestPasswordReset` / `requestEmailOtp`) and re-issues the code only for an existing, unverified registrant, returning a server-side boolean that drives the ledger decision (never reflected into the response). The pre-existing `requestEmailVerification(sub)` is not reused directly because it takes a resolved `sub`, whereas this endpoint receives a raw identifier and the port carries no other targeted lookup.
