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
union, and because the bodies are `.strict()` a client still sending `speakers`
is rejected with a 400 rather than having the field ignored.
