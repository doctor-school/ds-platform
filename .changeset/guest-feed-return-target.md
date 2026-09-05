---
"@ds/schemas": minor
"@ds/api": minor
"@ds/doctor": minor
---

feat(019 EARS-12): the doctor feed's guest read path and its registration hand-off

The registration return-target guard becomes an explicit WHITELIST of declared
shapes (021 LD-3): 005's `/webinars/<slug>` is unchanged, and a second shape —
`/events?<feed query>&resume=<slug>` — lets a guest who chose «Участвовать» on a
feed card come back to the feed exactly as they left it, on that card. Every
accepted value is RECONSTRUCTED from the one feed codec's entries, so an
undeclared parameter can never ride the return target.

The doctor event card payload now carries its own `slug` beside `href`, and the
doctor storefront projects a card CTA per viewer: a guest is handed off to
`/register` with the minted return target, a doctor goes to the event page.
