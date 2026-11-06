---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

The 025 rule book and accrual intake (EARS-3, 12, 25, #3808): versioned rule parameters with the PRD defaults seeded as version 1 (migration 0059, immutable versions), `RuleBookService.activeVersion`, `PointsFactIntake.accept` turning an accrual fact into one posting per non-zero denomination and publishing `PointsCredited` after commit, the ledger core's refusal of any Bre/Con debit that is not a reversal, and `POST /v1/admin/points/rules/:ruleId/versions` for publishing a new rule version.
