---
"@ds/api": major
"@ds/db": major
"@ds/schemas": major
---

012 EARS-24: provenance-safe speaker migration — an owner-reviewed classification artifact is imported into a `speaker_migration_reviews` queue (fail-closed on a missing / repeated / extra source UUID, no name matching or inference anywhere), each row is resolved to a canonical `event_experts` outcome, and a serializable `close-source` command advances the cutover phase and installs the rollback floor in one transaction, closing every free-text speaker seam.
