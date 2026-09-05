---
"@ds/db": major
---

012 EARS-24 — the schema drops the free-text speaker storage. The
`eventSpeakers` table definition is gone from `src/schema/events.ts`,
`legacySpeakerId` is gone from the `event_experts` link in
`src/schema/taxonomy.ts`, and `src/schema/speaker-migration.ts` — the phase
enum and cutover table of the withdrawn staged design — is deleted. Migration
`0036_speaker_cutover.sql` performs the drops in one release.

BREAKING: `event_speakers` and `event_experts.legacy_speaker_id` no longer
exist; anything reading them must source the line-up from `event_experts`.
