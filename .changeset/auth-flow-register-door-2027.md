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

The sign-up button is LIVE in every state, as the owner's canvas draws it. The
disabled submit and the reason line beside it are gone — with them the
`RegisterCardProps.unmetPrecondition` prop and the `RegisterCardTestIds.submitReason`
test id, both removed from the block's public surface (breaking for any consumer
that set them; both storefronts are updated here). Pressing with an access
condition still ungranted states it UNDER the row it belongs to — the same
sentence as before, now tied to its own checkbox, which turns to the danger tone
while the statement stands — and sends no command; granting one condition clears
only its own statement, and the optional opt-in never states anything. A host
that words a condition its read model carries no statement for says so in the
card's error banner instead, so a misconfiguration fails at the door rather than
silently at the server.

The consent block is drawn from the canvas: the access-conditions frame loses its
filled header bar for a quiet eyebrow inside a uniform padding, the two
conditions are separated by a hairline rule, and every consent label — the
marketing opt-in included — is bold in the ink tone above a small quiet help
line. `Checkbox` therefore renders its label bold everywhere it is used, and
paints its box in the danger tone while the control it wraps is `aria-invalid`.
