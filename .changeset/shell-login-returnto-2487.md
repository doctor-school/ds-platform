---
"@ds/storefront-shell": patch
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

The header «Войти / Регистрация» brings the visitor back (#2487): on both
storefronts the guest link is the sign-in route with the current page appended
as `returnTo`, reconstructed by the shared same-origin guard. On the host's own
auth doors (`authDoorPaths` of its `@ds/auth-flow` route table) the link carries
no target; home and feeds still land on the surface default, decided by the
sign-in door as before.
