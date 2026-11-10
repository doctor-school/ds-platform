---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

025 EARS-43 (#3840): the audited starter-bonus run `POST /v1/admin/points/starter-bonus { registeredBefore, reason }` (`platform_admin` only). Every doctor registered before the instant whose points account is not closed gets `person.starter-bonus-eligible` recorded once through `record` (event id `starter-bonus:<personId>`, `runId` attribute), so the seeded `accrual.starter-bonus` credits +20 Pul unless the doctor already has the registration grant (shared key `welcome`). Opening and closing `audit_ledger` records name the admin, reason, instant and counts; a re-run answers `duplicate`. New problem `points-starter-bonus-no-rule` (422) when no active rule triggers on the fact.
