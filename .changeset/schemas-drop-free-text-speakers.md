---
"@ds/schemas": major
---

012 EARS-24 — the free-text speaker contract is withdrawn from the SSOT.
`speakers` is removed from the event create/update bodies and from every event
read DTO, `LegacyBroadcastCreateBodySchema.speakers` is gone (the recordings
seam), the public speaker union keeps its `source` discriminator but narrows to
its single `expert` arm, and `legacySpeakerId` is off the `event_experts` link
schemas.

BREAKING: `LEGACY_SPEAKER_CONFLICT` is removed from the published error-code
union. A client still sending `speakers` on an event create/update has the key
STRIPPED (those bodies strip unknown keys) — the line-up it meant to set is
silently not set; on the `.strict()` legacy-broadcast create body the same key
is a hard 400.
