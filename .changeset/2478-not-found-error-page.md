---
"@ds/design-system": minor
"@ds/storefront-shell": minor
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

#2478: unknown addresses on both storefronts now render the not-found state of the platform's one error page — in Russian, inside the storefront shell (signed-in header included), HTTP 404 — instead of Next.js's English default (the Academy) or a bare white page (the doctor storefront). The page body is a new `StatusPage` design-system block; the sign-in refusal page now renders on it unchanged.
