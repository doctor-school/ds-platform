---
"@ds/storefront-shell": patch
---

The header «Войти / Регистрация» brings the visitor back to the event (#2487):
on both storefronts, on an event page the guest link is the sign-in route with
that page appended as `returnTo` — decided by the same return whitelist the
sign-in door lands on (`@ds/schemas` `parseReturnTarget`). Home, feeds and the
auth doors keep the bare route, so the door lands on the surface default.
