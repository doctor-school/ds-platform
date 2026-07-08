---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(room): 006 EARS-4 — server-authoritative heartbeat presence capture (append-only)

While a gated doctor is in a live room with the tab visible, the client posts an
authenticated heartbeat every N seconds and the backend appends each accepted
beat to a durable append-only Postgres table — the durable basis for the
per-doctor sponsor minutes (feature 006, EARS-4; realizes US-3).

- `@ds/schemas` — new `PresenceHeartbeatAckSchema` (`{ eventId, beatAt }`): the
  server-authoritative ack of one accepted beat. `beatAt` is the server-stamped
  instant the row was appended, never a client-supplied count/timestamp — a
  client cannot inflate its own presence (requirements Constraints).
- `@ds/db` — new append-only `presence_beats` table `(id, user_id, event_id,
beat_at)` (ADR-0003 §3). Immutable rows (no mutable column → nothing to update
  in place); `beat_at` defaults to the server clock; a composite
  `(event_id, user_id, beat_at)` index serves the EARS-5 derivation read.
- `@ds/api` — `POST /v1/events/:idOrSlug/heartbeat` → `RecordPresenceHeartbeat`,
  behind the **same** server-side gate as the EARS-1 `RoomConfig` read (one gate,
  reused): a guest (401), an unregistered doctor (403), and a non-`live` / `ended`
  event (409) are each refused server-side and append **nothing** (EARS-8). On
  admission it appends exactly one row and returns the ack. Classified
  `authenticated` / `doctor_guest` / `policy` in the endpoint-authz matrix.
- `@ds/portal` — the room mounts a visibility-gated `PresenceHeartbeat` loop (no
  doctor-facing affordance): it POSTs a beat every N seconds — N from
  `RoomConfig.heartbeatIntervalSeconds` (server config, default 60 s) — while the
  tab is the visible, active tab (Page Visibility API); a backgrounded tab
  (`document.hidden`) emits none, and the loop resumes on re-visibility.

Cadence N is server config, parameterized downstream: the per-doctor
minute derivation + concurrent-tab coalescing is EARS-5 (#581), room-close
refusal is EARS-7 (#583), chat is EARS-3 (#579). The 006↔007 lifecycle seam
(live/ended driven by seeded events until 007 lands) is unchanged.
