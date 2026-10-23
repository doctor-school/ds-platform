---
"@ds/auth-flow": minor
"@ds/schemas": minor
"@ds/storefront-shell": patch
"@ds/account": patch
"@ds/event-page": patch
"@ds/api": minor
"@ds/portal": minor
"@ds/doctor": minor
"@ds/login": patch
---

«Войти», registration and password reset on both storefronts now run on the shared sign-in page, and the person comes back signed in on the page they started from. Signing out on a storefront also ends the shared sign-in, so the next «Войти» asks for the password again.
