---
"@ds/api": patch
---

fix: the registration verification email is code-only (#869). Both email-verification sends (initial EARS-3 + EARS-25 resend) deliver a branded Russian mail whose subject leads with the code and whose body shows it grouped for reading with an explicit 1-hour expiry — no code-consuming link (mail-scanner AV prefetch GETs every URL in a delivered message, burning GET-consumed deep-links). Zitadel's default CTA into its hosted login-v2 UI is replaced by a bare portal `/verify` navigation URL (`SendEmailVerificationCode.urlTemplate`, no query/params — nothing consumed on GET); the user types the code on the portal `/verify` screen where the existing auto-login replay signs them in. The `/v1/auth/verify` contract, SMS hops, and enumeration-safety (EARS-16/24/25) are unchanged.
