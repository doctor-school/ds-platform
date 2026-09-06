---
"@ds/room": minor
"@ds/portal": patch
"@ds/doctor": patch
---

006 EARS-7 — an already-open room degrades to an ended state instead of keeping
a dead live stream on screen. `RoomApiError` now carries the lifecycle `state`
parsed from a refusal body; the presence heartbeat promotes a `409` refusal
whose state is present and not `live` to a one-way `onRoomClosed` latch and
stops beating. The room shell lifts that phase, so the player slot is replaced
by the «Эфир завершён» end card (no iframe, no live badge, no restart button),
the header pill goes neutral without a duration, and the chat composer is
replaced by a truthful status strip while the message ledger stays readable.
Both hosts map the four new RU copy keys.
