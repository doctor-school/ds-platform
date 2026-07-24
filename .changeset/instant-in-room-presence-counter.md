---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

Instant in-room presence counter — server-published count over Centrifugo (006 EARS-5, #1141).

The live «N врачей в комнате» webinar-room counter now updates the moment another
doctor joins or leaves — within ~1 s — instead of only on the observer's own next
heartbeat (the #1122 "frozen until my beat" perception). The count stays the same
server-authoritative distinct-doctor aggregate (never Centrifugo native channel
presence; sponsor attendance reporting is untouched).

- `@ds/schemas` — a new `RoomPresenceCountMessage` (a `type: "presence-count"`
  discriminant) fanned out over the room channel; it never cross-parses a chat
  message.
- `@ds/api` — on an accepted beat that CHANGES the distinct-doctor count, or a
  presence-window expiry (a leave, caught by a per-room timer), the recomputed count
  is published to the existing `room:event:<id>` channel. Publish only on change;
  best-effort, so a Centrifugo blip never turns a beat into an error.
- `@ds/portal` — the room's single Centrifugo connection (owned by the chat panel)
  routes the published count straight into the header. When the channel is
  unavailable the counter degrades to the heartbeat-ack refresh path (#1136) —
  beat-paced, never silently frozen.
