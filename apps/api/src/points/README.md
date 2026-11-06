# `points` — 025 attention-points engine

Spec: `apps/docs/content/specs/features/025-attention-points-engine/` (design §1–§3, §9). Tables: `packages/db/src/schema/points-ledger.ts` + migration `apps/api/drizzle/0058_points_ledger.sql`. Contracts: `packages/schemas/src/points/`.

## What ships (#3807 — the ledger core)

- `PointsLedgerService.resolvePersonAccount(personId)` — **the** account-resolution API (EARS-1). Opens the person's one `attention_points` account on first need; concurrent first needs converge on the unique (`subject_kind`, `subject_id`, `unit`). `resolveSystemAccount(code)` does the same for `issuance` / `reserve` / `sink` / `advance`.
- `PointsLedgerService.post(fact)` — **the** write entry point. One transaction: resolve accounts → lock the person accounts `FOR UPDATE` in id order (per-account serialisation, EARS-22) → refuse a closed account (`points-account-closed`, EARS-31) → insert the fact's `points_posting_keys` row; a conflict on `event_id` or dedupe key writes nothing and answers `{ status: "duplicate", postings }` (EARS-4) → refuse a leg taking a person's available Pul below zero (`points-insufficient-pul`, EARS-22) → write the postings.
- `PointsLedgerService.close(personId, at)` — the personal-data-lifecycle seam (EARS-31): sets `closed_at` once; postings are untouched, no reserve is released and no obligation settled.
- Refusals are `PointsLedgerError` (RFC 7807 body via `toProblemDetails`).

## Invariants the database enforces

- Postings are immutable: a `BEFORE UPDATE OR DELETE` trigger refuses every row, and the same for `points_posting_keys` (EARS-27, EARS-4).
- `points_postings` is `PARTITION BY RANGE (occurred_at)`, monthly partitions 2026-01..2027-12 + DEFAULT, pg_partman from 2028-01; unique (`event_id`, `leg`, `occurred_at`); `rule_id` / `rule_version` NOT NULL with a composite FK to `points_rule_versions`; `amount > 0`; an insert trigger requires a denomination on `attention_points` postings and one unit per posting.
- A balance is a fold `Σ credits − Σ debits` per (account, denomination) — there is no balance column.

## Not here yet

Rule evaluation and the default rule book (#3808), reserves/spend/obligations (#3810), leaderboard (#3812), HTTP reads (#3813), corrections and aggregates (#3814). `points_rule_versions` exists as a table only; no publish API and no seeded rule. No expiry posting exists anywhere (EARS-22). There is no HTTP controller in this module.
