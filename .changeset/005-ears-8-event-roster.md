---
"@ds/schemas": minor
---

feat(events): 005 EARS-8 — durable registration record + EventRoster read model

Adds the `EventRoster` contract to `@ds/schemas` — the set of **current**
registrations for one event, the durable basis feature 006 (room admission) and
the wave-2 sponsor report consume (005 EARS-8; realizes US-5).

- `@ds/schemas` — new `EventRosterEntrySchema` / `EventRosterSchema` (+ types):
  each entry carries **no more than** the `(doctor, event, registeredAt)` fact
  (`{ userId, eventId, registeredAt }`) — no email, name, or any denormalized
  registrant PII. A consumer that needs identity joins to the 003 `users` mirror
  at read time.

The registration record itself (the `registrations` table + `UNIQUE
(user_id, event_id)`) landed with EARS-1/EARS-3; this handler layers the roster
read on top: `RegistrationRepository.findEventRoster` +
`RegistrationService.eventRoster` in `apps/api` read every registration row for
an event (wave 1 has **no** cancelled state / soft-delete, so the roster is every
row and every entry is current — owner decision). The roster is an **internal**
read with **no public endpoint** — never exposed on a 004 public surface, so no
registrant PII leaks (cross-checked against the public projection). It is owned
here and consumed cross-feature by 006 + the report — not wired here.
