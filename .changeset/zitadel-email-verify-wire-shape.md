---
"@ds/api": patch
---

fix(api): #148 email/phone-verify resend wire-shape vs live Zitadel v4.15

First live smoke-test of `ZitadelIdpClient` email/phone verification against a
dev-stand Zitadel v4.15 surfaced four 404 wire-shape deltas masked by the
`FakeIdpClient` and the scripted unit double (same class as #145/#122). The
custom-verb paths were renamed to the live REST shapes:

| Op           | Was (404 live)                         | Now (200 live)                     | Body                          |
| ------------ | -------------------------------------- | ---------------------------------- | ----------------------------- |
| email send   | `POST /v2/users/{id}/email/_send_code` | `POST /v2/users/{id}/email/resend` | `{ "sendCode": {} }`          |
| phone send   | `POST /v2/users/{id}/phone/_send_code` | `POST /v2/users/{id}/phone/resend` | `{ "sendCode": {} }`          |
| email verify | `POST /v2/users/{id}/email/_verify`    | `POST /v2/users/{id}/email/verify` | `{ "verificationCode": "…" }` |
| phone verify | `POST /v2/users/{id}/phone/_verify`    | `POST /v2/users/{id}/phone/verify` | `{ "verificationCode": "…" }` |

The send body is a oneof: `sendCode` routes the code through Zitadel's SMTP
notifier (→ Mailpit on the dev-stand) and never echoes the secret inline.
Fail-closed discipline is preserved — a non-2xx send still throws. Email send +
verify are live-verified via a new `IDP_ISSUER`-gated round-trip e2e (send →
fetch from Mailpit → verify) that skips in CI; phone paths are aligned by parity
(the dev-stand has no SMS provider). No portal-facing contract change — internal
Zitadel-adapter fixes only.
