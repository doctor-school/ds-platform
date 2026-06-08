---
"@ds/api": minor
---

feat(api): #153 wire EARS-6/7 OTP-login against real Zitadel Session v2

The real Zitadel adapter's four passwordless-login methods — `requestEmailOtp`,
`loginWithEmailOtp`, `requestSmsOtp`, `loginWithSmsOtp` — were fail-closed seams
that rejected, so no passwordless login (EARS-6 email / EARS-7 SMS) could
complete against a real Zitadel; only password login (#122) and verification
(#148) were live-wired. They are now real Session v2 wire calls, the twin of
#122/#148.

The request hop creates a Zitadel session with a `user` check plus an
`otpEmail`/`otpSms` challenge (`POST /v2/sessions`) so Zitadel dispatches the
code via its notifier; it is enumeration-safe like `requestPasswordReset` — an
unknown identifier or any provider error still resolves void, never an existence
oracle. The verify hop updates the same session with the submitted code
(`POST /v2/sessions/{id}`) and, on a 2xx, caches the checked-session token via
`rememberSessionToken` so the shared `exchangeSessionForTokens` hop mints tokens;
any miss (no live challenge / wrong-or-expired code / unknown identifier) returns
`null`, all indistinguishable (EARS-16). The challenge is carried between the two
port calls by a new `otpChallenges` Map keyed by the lowercased identifier,
mirroring the existing `sessionTokens` cache — a second hidden cross-request
state on the singleton adapter that openly ADDS to the #143 (IdpSession port
widening) debt rather than deepening it silently.

The exact Session-v2 field names/paths are pinned deterministically by the
adapter unit spec and AWAIT live confirmation against the dev-stand (the accepted
#122→#145/#148 precedent). A new `IDP_ISSUER`-gated integration spec proves the
email path end-to-end (request → Mailpit → login → token exchange) and SKIPS in
CI; the SMS path has no dev-stand provider and is declared honestly as
unit-pinned-only, not faked green. The `FakeIdpClient`-backed BFF suites are
unchanged.
