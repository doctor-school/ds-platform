---
"@ds/events-storefront": minor
"@ds/portal": patch
"@ds/doctor": patch
---

005 EARS-1/2/3/4 on doctor.school — one-tap эфир registration, as ONE shared
control on both storefronts.

The Academy one-tap registration and its completion-on-return rule move out of
`apps/portal/{app/webinars/[slug],lib}` into the new `@ds/events-storefront`
package (tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §4 Stage 0):
the `RegisterOneTap` control (`./ui`), the browser transport (`./client`), the
session-bound registration read and the server action (`./server`), and the
`completeReturnTarget` decision rule (`.`). Each host supplies only its own
projection — which return shapes are its own, where nothing lands, its own copy
and its own event path.

The doctor storefront now reads the per-viewer registration state on
`/events/<slug>` and renders that control for a signed-in doctor who is not yet
registered, so the card flips to «Вы записаны» in place. Both of its auth doors
complete a carried эфир intent once the session exists: `/login` after sign-in,
and `/register` after the held-password replay that follows email confirmation
(003 EARS-39). A guest still goes through `/register?returnTo=…` and arrives
registered. Academy behaviour is unchanged — only the code moved.
