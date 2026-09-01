---
"@ds/db": minor
---

Add the `speaker_migration_cutover` schema (012 EARS-24): a retained singleton
recording the legacy-speaker cutover phase, the phase-aware release SHA/ordinal
and the minimum-compatible release SHA/ordinal that `deploy:prod --rollback`
enforces as a compatibility floor. Additive — a new export from `@ds/db/schema`,
no existing table or column changed.
