---
"@ds/design-system": minor
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One sign-up door on both storefronts (#2027, epic #2020 wave 1).
`@ds/auth-flow/register` owns the `/register` screen — the credential fields, the
consent block, the bot-protection challenge and the post-registration confirmation
step — and both hosts mount it from their own route file plus host config. The
Academy door is now rendered by the package rather than by
`apps/portal/app/register/page.tsx`, with no change a signed-in user can see.

Both doors gain the already-registered visitor's way out, «Уже есть аккаунт?
Войти» (#2331), which carries the return target forward like every other
transition between auth screens; the shared error dictionary now answers a
rate-limited (429) or failing (5xx) sign-up with the same sentence on both hosts;
and a return target only rides along once the shared guards have revalidated it.

Consent tiers, the medical-worker declaration and the partner-data item stay host
DATA, so each storefront keeps asking exactly what it asked before. The doctor
storefront's confirmation step is unchanged in what it does and says — it is now
rendered by the package.

`<RegisterCard>` draws ONE sign-up composition now. The three host-divergence
knobs (`submitBlock`, `spacing`, `pendingAffordance`) are gone and the block
follows the owner's canvas on both storefronts: the withdrawal note sits inside
the access-conditions frame, a hairline rule separates the conditions, the
read-only «продолжая, вы соглашаетесь…» statement stands after that frame and
above the challenge, and the optional opt-in below the submit carries no
«необязательно» marker — its position says it. A new `partnerPlateSlot` renders
the partner-link notice under the promo field. `<LoginCard>` moves the challenge
from the head of the sign-in-code step to directly above the button it protects,
as it already stood on the password method. The `Checkbox` box no longer shrinks
when its label wraps onto several lines.

Every auth sentence now has ONE source: the package copy defaults, taken from the
owner's auth canvas. A host config states the SET of fields it renders, its routes,
endpoints, channels and brand assets — no host words a field any more, and the
optional `copy` deep-partial override stays declared but unused on both storefronts.
