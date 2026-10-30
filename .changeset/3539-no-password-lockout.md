---
"@ds/api": patch
---

#3539: wrong passwords no longer lock an account. IdP provisioning turns the Zitadel password lockout off (`maxPasswordAttempts = 0`) on every environment and reads it back fail-closed, because a lock signed the person out of every device and anyone who knew their address could trigger it. Guessing stays bounded by the per-user / per-IP / per-ASN rate limits and captcha, whose windows now live in Redis so a restart, deploy or second replica cannot reset them; a password login the limiter refuses is audited as `auth.login.failure` reason `throttled` (003 EARS-15, ADR-0001 §7).
