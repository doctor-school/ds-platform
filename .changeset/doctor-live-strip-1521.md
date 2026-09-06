---
"@ds/schemas": minor
"@ds/design-system": minor
"@ds/api": patch
"@ds/doctor": patch
---

019 EARS-6 — the «Идёт сейчас» block above the doctor events feed, server-resolved and self-clearing

A running эфир no longer hides below the feed horizon: `GET /v1/storefront/doctor/events/live` answers the one targeted live event (earliest `startsAt` when several run at once) or `null`, and the doctor storefront renders the strip above the feed. Liveness and entry policy stay where they already live — 006's lifecycle state through `RoomService`, registration through `ParticipationService` — so a registered doctor's action opens the room and everyone else's opens the event page; the client never derives liveness from a start time. The strip itself is a shared block, `@ds/design-system/blocks` `LiveEventStrip`, built from the canvas, and it clears itself on a bounded 30-second refresh (`DOCTOR_EVENTS_LIVE_REFRESH_SECONDS`) rather than on a reload, while a failed poll keeps the last known strip.
