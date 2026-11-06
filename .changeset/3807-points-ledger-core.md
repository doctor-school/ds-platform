---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
---

The 025 attention-points ledger core (EARS-1, 4, 22, 27, 31, #3807): tables `points_accounts`, `points_posting_keys`, `points_rule_versions` and the monthly-partitioned, append-only `points_postings` (migration 0058); `PointsLedgerService` in `apps/api/src/points/` — the one account-resolution API and the one fact write entry point (per-account serialisation, database-enforced dedupe by event id or dedupe key, no overdraw of available Pul, `points-account-closed` for a frozen account) — and the fact/outcome contracts in `@ds/schemas`.
