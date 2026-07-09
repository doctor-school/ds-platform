---
"@ds/schemas": minor
"@ds/api": minor
---

feat(room): 006 EARS-5 — per-doctor presence-minute derivation (parameterized over N, tab-coalesced)

The append-only `presence_beats` rows EARS-4 captures now yield **actual per-doctor
presence minutes** for an event — the durable basis for the wave-1 sponsor report,
by manual export (feature 006, EARS-5; realizes US-3, US-4). Read-time derivation
only: no new write, no report UI, no public endpoint.

- `@ds/schemas` — new `EventPresenceSchema` (`{ eventId, intervalSeconds, doctors:
[{ userId, eventId, minutes }] }`) + `DoctorPresenceMinutesSchema`: the per-event
  presence read model. `minutes` are **derived**, never stored (there is no count
  column); the per-doctor unit is the opaque domain `userId` only — no registrant
  PII (EARS-8).
- `@ds/api` — `PresenceDerivationService.deriveForEvent(eventId, intervalSeconds?)`
  - `PresenceRepository.deriveEventMinutes` compute minutes as `(distinct N-second
buckets a doctor emitted a beat in) × N / 60` over the append-only beats. Two
    load-bearing properties fall out of the DISTINCT bucket count: **parameterized
    over N** — `intervalSeconds` defaults to `ROOM_HEARTBEAT_INTERVAL_SECONDS`, so an
    operator-confirmed different cadence recomputes the SAME beats with no code
    change; and **concurrent tabs never inflate** — a doctor's parallel-session beats
    land in the same buckets and collapse under DISTINCT (two tabs in one bucket
    count once).
- `@ds/api` — the wave-1 **manual sponsor export** is a standalone ops CLI
  (`pnpm --filter @ds/api presence:export -- <event-id-or-slug> [intervalSeconds]`),
  an HTTP-less Nest context that prints the `EventPresence` JSON — **not** a public
  endpoint (the derivation is never exposed on a public surface, EARS-8).

The wave-2 auto report «Отчёт партнёра V2» + auto-NMO consume this same derivation;
room-close windowing is EARS-7 (#583) — minutes here are computed over the beats
that exist (EARS-4 already refuses beats once the room leaves `live`).
