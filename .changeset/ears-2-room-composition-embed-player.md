---
"@ds/schemas": minor
"@ds/design-system": minor
---

006 EARS-2 — room composition + embed player from the explicit provider enum.

- `@ds/schemas`: `RoomConfigSchema` gains the additive, nullable `stream`
  (`{ provider, embedRef } | null`) reusing the `StreamConfig` SSOT — the
  server-produced embed source the room instantiates the player from. A gated
  caller for a `live` event with no/unknown stream config still receives a grant
  with `stream: null` (the truthful "stream unavailable" room state); the provider
  is read from the closed enum, never URL-sniffed.
- `@ds/design-system`: new `WebinarRoomLayout` primitive — the neo-brutalist room
  composition shell to the `webinar-room.dc.html` geometry (desktop `1fr 400px`
  player + chat aside; mobile full-bleed player + Чат / О эфире tabs).
