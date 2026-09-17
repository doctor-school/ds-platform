---
"@ds/auth-flow": minor
"@ds/storefront-shell": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One server auth read for both storefronts (#2027, epic #2020 wave 1). The
session cookie, the authenticated SSR read with its ADR-0001 §6 fingerprint
headers, the signed-in guard on the auth screens and the `returnTo` parking
rule move out of `apps/portal/lib/{header-auth,return-to-origin,use-redirect-if-authenticated}.ts`
and `apps/doctor/lib/{session,shell-auth}.ts` into `@ds/auth-flow/server`. Each
host keeps only its own route values (`lib/auth-flow-routes.ts`): which paths
are its auth screens, which of them a signed-in user may still complete, and —
on the Academy — the cookie the middleware parks a return target in.
`@ds/auth-flow/server` re-exports the session declaration that stays owned by
`@ds/events-storefront/server`, so the cookie name and the fingerprint surface
exist once in the repo and auth consumers read them from one address.

Two user-visible deltas ride along. The doctor storefront's `/register` gains
the signed-in guard it never had (#675 parity): a signed-in doctor opening it is
sent on instead of being shown a registration form. And a doctor who is sent to
`/login?returnTo=/account` now lands back on `/account` after signing in
(#1987) instead of on the events landing — the Academy already did this; the
`/account` landing shape now lives in the shared codec both hosts read.
Everything else — the screens, their copy, the order of the steps — is
unchanged on both storefronts.
