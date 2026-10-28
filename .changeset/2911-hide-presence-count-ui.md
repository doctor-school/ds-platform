---
"@ds/room": major
"@ds/events-storefront": patch
"@ds/admin": minor
---

The room, the «Идёт сейчас» strip and the admin event editor follow the withheld live participant count (006 EARS-19, 019 EARS-30, 007 EARS-13, #2911). `@ds/room`: the presence context holds `number | null` — `RoomPresenceProvider.initialCount`, `usePresenceCount()` and `usePresenceCountSetter()` now take/return `number | null` (breaking for consumers of those exports); a `null` count renders no header «N врачей в комнате» and no chat-heading « · N», a heartbeat ack carrying `null` drops the shown count, and the room's Centrifugo handler applies a `presence-count` message arriving on the staff-only `chat.staffChannel` (and nothing else from that channel). `@ds/events-storefront`: a strip whose `presenceCount` is `null` carries no «N в комнате» segment. `@ds/admin`: the event form gains the checkbox «Показывать зрителям число участников» (default off, not offered on an архивный эфир create), sent on create and update and pre-filled on edit.
