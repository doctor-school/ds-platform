---
"@ds/db": minor
"@ds/schemas": major
"@ds/api": major
"@ds/api-client": major
---

The live participant count is hidden from viewers by default (006 EARS-19, 007 EARS-13, 020 EARS-24, 019 EARS-30, #2911). Migration `0052` adds `events.show_presence_count boolean not null default false` (every existing event now hides the count from viewers). `CreateEvent` accepts `showPresenceCount` (default `false`), `UpdateEvent` sets it only when the key is present, and `EventAdminDetail` returns its state. While it is off, a caller whose session claims carry no staff role receives `presenceCount: null` from the `RoomConfig` read, every heartbeat ack, the room-entry participation CTA and each «Идёт сейчас» strip, and the realtime `presence-count` message rides the new staff-only `room:staff:<id>` channel that only a staff caller's connection token lists (`RoomChatCredential.staffChannel`, `null` for a viewer); while it is on, it rides the shared `room:event:<id>` channel as before. Staff always receive the count. Turning the setting on or off on a live event re-publishes the count to the new audience at once. Presence capture and minutes are unchanged. Breaking: `RoomConfig.presenceCount`, `PresenceHeartbeatAck.presenceCount` and `EventLiveStrip.presenceCount` are now `number | null`, and `RoomChatCredential` gains the required `staffChannel: string | null`.
