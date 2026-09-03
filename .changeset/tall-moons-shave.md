---
"@ds/schemas": minor
"@ds/design-system": minor
"@ds/api": patch
"@ds/doctor": patch
"@ds/portal": patch
---

020 EARS-2 slice 1 — the registration-free decision set. The public event read
now carries `links: AroundEvent` (school / speaker pages / community), resolved
per host by one shared resolver from a route table each storefront owns; a
destination that does not exist has no key at all, so the page renders plain
text rather than a dead link. The «Программа» section now always renders — the
PDF download when one is attached, and otherwise an honest lifecycle-specific
statement instead of an omitted block. «О чём событие», «Программа» and the hero
kicker move out of the two host routes into shared `@ds/design-system` blocks.
