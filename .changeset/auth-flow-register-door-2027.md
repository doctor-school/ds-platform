---
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
