---
"@ds/design-system": patch
---

012 EARS-24 — `eventSpeakerCards` follows the narrowed projection: the speaker
union now has exactly one arm (`source: "expert"`), so every card carries an
expert identity — the href is looked up by `expertSlug` unconditionally and the
legacy branch that suppressed the role kicker is dead code and removed. The
block's own exported props are unchanged; only the input type it consumes from
`@ds/schemas` narrowed.
