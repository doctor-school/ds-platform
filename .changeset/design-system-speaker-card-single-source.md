---
"@ds/design-system": patch
---

012 EARS-24 — `eventSpeakerCards` follows the narrowed projection: with
`source` gone from the speaker entry, every card carries its expert identity, so
the href is looked up by `expertSlug` unconditionally and the legacy branch that
suppressed the role kicker is removed. The block's own exported props are
unchanged; only the input type it consumes from `@ds/schemas` narrowed.
