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
follows the owner's canvas on both storefronts: no consent-withdrawal sentence
stands on the door (the package default `managerNote` is gone; `consentNote`
stays a generic slot no host fills), a hairline rule separates the conditions, the
read-only «продолжая, вы соглашаетесь…» statement stands after that frame and
above the challenge, and the optional opt-in below the submit carries no
«необязательно» marker — its position says it. A new `partnerPlateSlot` renders
the partner-link notice under the promo field. `<LoginCard>` moves the challenge
from the head of the sign-in-code step to directly above the button it protects,
as it already stood on the password method. The `Checkbox` box no longer shrinks
when its label wraps onto several lines.

Every auth sentence now has ONE source: the package copy defaults, taken from the
owner's auth canvas. A host config states the SET of fields it renders, its routes,
endpoints, channels and brand assets — no host words a field any more. The
optional `copy` deep-partial override carries exactly one host statement: the
Academy's brand panel (eyebrow «Академия Doctor.School», headline «Среда обитания
экспертов здравоохранения», footer «© Doctor.School.», no sub-copy line); the
doctor storefront keeps the package brand copy. `AuthFlowBrandCopy.subcopy` is
`string | null`, and `<AuthShell>` renders no sub-copy node when its `copy.subcopy`
is absent or null. The sign-in password field shows the same canvas `••••••••`
placeholder as sign-up on both hosts (new optional
`LoginCard` `copy.password.passwordPlaceholder`, package default in auth-flow).

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

The auth card family now renders to the canvas measures on both storefronts: the
logo, the card and the processing notice under it share a 440px column (new
`--container-auth` token, `max-w-auth`); the title stands 10px above its
sub-copy; the badge glyph is 26px and takes the tile's accent in dark mode too;
the «Уже есть аккаунт? Войти» line sits 24px under the form instead of 36px; an
error-free sign-up card no longer reserves an empty banner gap above the glyph;
the invisible bot-protection mount no longer adds a second gap above the submit;
the password hint hangs 7px under its field; the processing notice under the card
is a left-aligned faint 12/18 line; and the sign-up password field shows the
canvas `••••••••` placeholder (new `RegisterCardCopy.passwordPlaceholder`).
