---
"@ds/api": major
---

012 EARS-24 — the event speaker line-up has a single source. `event_experts`
links to published experts are now the only thing any read resolves: the
free-text `speakers` array is gone from the event write contract and from every
read DTO, the dual-source projection in `speaker-projection.{service,repository}`
lost its legacy arm and orders on `position ASC, linkId ASC`, and
`storefront/doctor-events.repository.ts` (`findLeadSpeakers`) plus
`events/around-event.resolver.ts` read links instead of the withdrawn table.
The staged-migration machinery of the withdrawn design is removed with it —
`events/event-speakers.reconcile.ts`, the migration-phase fence and its e2e
spec, and the `tools/deploy` rollback floor. Migration
`0036_speaker_cutover.sql` drops `event_speakers`, `event_experts.legacy_speaker_id`
(with its FK and unique index) and the 0032 phase objects in one release.

BREAKING: a client that still sends `speakers` on an event write now gets a
hard 400 (`.strict()`), and `LEGACY_SPEAKER_CONFLICT` is no longer a member of
the published error-code union.
