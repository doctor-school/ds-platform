---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(room): 006 #690 — realize deferred webinar-room header canvas elements (live presence count + live-duration)

Realizes two of the four canvas header elements #584 deferred as tracked
decision-debt, each now backed by real data (no faked/hardcoded values):

- **Live presence count** («N врачей в комнате») — a server-side aggregate over
  the existing append-only `presence_beats`: the count of distinct doctors with a
  beat inside the freshness window (2 × the heartbeat cadence N). It rides the
  EARS-1 `RoomConfig` grant (initial value) and every heartbeat ack (live
  refresh), and the portal header renders it desktop-only per the canvas. An
  integer aggregate only — never per-doctor identity or the roster (EARS-8).
- **Live-duration «· N мин»** on the live pill — counted from the event's actual
  go-live instant. Adds a nullable `events.live_at` column stamped once by 007
  `OpenRoom` (the `published → live` transition); the grant exposes it and the
  room counts elapsed minutes from it, never the scheduled `startsAt`. A legacy
  `live` row with no `live_at` renders the pill with no suffix (truthful).

Additive schema growth (`RoomConfig.liveAt` + `RoomConfig.presenceCount`,
`PresenceHeartbeatAck.presenceCount`) and one additive migration
(`events.live_at`). The theme toggle (re-deferred to #702, dark theme with it)
and the doctor avatar (no server-side display name exists — re-deferred) remain
canvas omissions, never dead affordances.
