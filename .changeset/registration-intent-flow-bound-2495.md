---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

A registration intent lives only inside the sign-in flow that carried it
(#2495, 014 EARS-6 amendment 2026-09-30). The shared `parkReturnTarget` rule
now drops the parked `ds_return_to` target when a guest opens an auth door
(`/login`, `/register`, `/verify`, `/reset`) without a guard-clean `returnTo`,
so pressing «Записаться», abandoning the sign-in and later signing in through
the header no longer registers the visitor. Both storefronts wire the same four
doors; the reset door joins the doctor proxy and the Academy middleware matcher.
