---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): #87 passwordless login — email-OTP + SMS-OTP + SMS budget (003 F3)

Implements EARS-6 (email-OTP login via Zitadel `otp_email`), EARS-7 (SMS-OTP
login via `otp_sms`), and EARS-14 (SMS toll-fraud budget circuit-breaker), per
003-design §2/§6/§10 and ADR-0001 §4/§7. Both OTP variants converge on the F2
session-establishment step (`SessionService.establish`), so the `__Host-`
cookie / token logic exists exactly once across every login variant.

`@ds/api`: extends the `IdpClient` port with `requestEmailOtp` /
`loginWithEmailOtp` / `requestSmsOtp` / `loginWithSmsOtp` (the verify methods
return a checked `IdpSession`, the same shape `passwordLogin` yields; fake is
fully exercised, the Zitadel adapter carries them as documented design-§11
integration seams alongside the existing token-exchange seam). Adds a
`SmsBudgetService` — four fixed-window counters (per-phone 3/h, per-IP 10/h,
per-ASN 100/h, global daily ≤2000) that gate before the provider send and refuse
fail-closed with a generic throttled response, consuming nothing on refusal. New
public routes `POST /v1/auth/login/otp/request` and `POST /v1/auth/login/otp`
(channel discriminator; SMS request budget-gated, ASN from the edge `x-asn`
header). Enumeration-safe throughout (EARS-16): unknown identifier and
wrong/expired code are indistinguishable; budget refusals leak no threshold.

`@ds/schemas`: adds the `OtpChannel`, `OtpRequest` / `OtpRequestResponse`
(`otp_sent`) and `OtpVerify` contracts (verify reuses the `authenticated`
`LoginResponse`).
