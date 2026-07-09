---
"@ds/api": patch
"@ds/portal": patch
---

feat(room): 006 EARS-7 — room-close stops heartbeat + chat capture

When the event leaves `live` (the director closes the room, feature 007), the
system stops accepting heartbeats and chat posts for that event and the room
degrades to the truthful ended state (feature 006, EARS-7; realizes US-3, US-4).
This handler adds no new code path — the refusal is the SAME server-side admission
gate as EARS-1 (`authenticated ∧ registered ∧ live`): once the event leaves `live`
the `live` condition fails and every room operation is refused server-side. EARS-7
pins that close semantics as one coherent, verified story.

- `@ds/api` — the `RoomConfig` grant read, the gated heartbeat, and the gated chat
  post are each refused with a `409` carrying the truthful `ended` state once the
  room closes. A beat/post accepted while the room was open is refused the instant
  it closes, and NO beat or post lands after close (`presence_beats` does not grow).
  Per-doctor presence minutes (EARS-5) are therefore computed over the beats
  captured **while the room was open** — a beat refused after close never exists,
  so it cannot inflate the sponsor minutes. Pinned by the Vitest e2e
  (`apps/api/test/room/room-close.e2e-spec.ts`).
- `@ds/portal` — the room surface degrades TRUTHFULLY: after close the gate no
  longer issues the grant, so the `not-live` branch routes the doctor to the 004
  ended lifecycle state («Эфир завершён») with no watchable player, no writable
  chat, and no room composition — never a soft wall over a dead room. Verified
  end-to-end on the live stand (`apps/portal/e2e/room-close.spec.ts`).

The 006↔007 lifecycle seam is unchanged (the live → ended transition is driven by
seeded events until 007's director controls land, tracked on parent #576);
Stage-B canvas fidelity is batched at #584.
