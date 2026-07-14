---
"@ds/schemas": minor
"@ds/api": patch
"@ds/portal": patch
---

fix: the registration verification email's CTA now deep-links to the portal's own `/verify` screen instead of Zitadel's hosted login-v2 page (#869). Both email-verification sends (initial + EARS-25 resend) carry Zitadel's `urlTemplate` → `<MAILER_PORTAL_BASE_URL>/verify?code={{.Code}}&userId={{.UserID}}`; `/v1/auth/verify` additively accepts `{ userId, code }` alongside `{ email, code }` (Zitadel's template has no email placeholder), and the portal `/verify` screen prefills + auto-submits the deep-linked code with the userId identity, degrading the masked-destination copy gracefully and falling back to `/login` when no held password exists. SMS/phone hops and enumeration-safety (EARS-16/24/25) are unchanged.
