---
"@ds/design-system": minor
"@ds/doctor": minor
"@ds/showcase": minor
"@ds/portal": patch
---

Doctor storefront `/account`: the shell's signed-in «Личный кабинет» action now
resolves to a real route instead of a 404. The account-profile composition (003
EARS-27/28) is lifted out of the Academy page into the shared
`@ds/design-system/blocks` `<AccountProfileCard>`, and both storefronts mount that
one block — the Academy keeps its `next-intl` copy and routes, the doctor host
passes RU literals, its own `/v1` transport and a storefront landing on sign-out.
A `null` href hides its row, so no host renders a link it cannot serve. The
showcase catalogues the new block; the Academy surface itself is unchanged.
