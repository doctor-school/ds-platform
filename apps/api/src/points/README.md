# `points` — 025 attention-points engine

Spec: `apps/docs/content/specs/features/025-attention-points-engine/` (design §1–§3, §9). Tables: `packages/db/src/schema/points-ledger.ts` + migration `apps/api/drizzle/0058_points_ledger.sql`. Contracts: `packages/schemas/src/points/`.

## What ships (#3807 — the ledger core)

- `PointsLedgerService.resolvePersonAccount(personId)` — **the** account-resolution API (EARS-1). Opens the person's one `attention_points` account on first need; concurrent first needs converge on the unique (`subject_kind`, `subject_id`, `unit`). `resolveSystemAccount(code)` does the same for `issuance` / `reserve` / `sink` / `advance`.
- `PointsLedgerService.post(fact, tx?)` — **the** write entry point. Joins the caller's drizzle transaction when given (as a savepoint — a refusal rolls back only the fact; design §1), else opens its own. Refuses a fact dated more than one day ahead before touching the database (`points-occurred-at-future`, 422, EARS-27) → open every account the legs name in sorted key order, then lock the person accounts `FOR UPDATE` in id order (per-account serialisation without lock-order deadlocks, EARS-22) → insert the fact's `points_posting_keys` row; a conflict on `event_id` or dedupe key writes nothing and answers `{ status: "duplicate", postings }` (EARS-4) — even if the account has closed since → refuse a closed account (`points-account-closed`, EARS-31) → refuse a leg taking a person's available Pul below zero (`points-insufficient-pul`, EARS-22) → write the postings. System accounts are not locked: they carry no balance check, and locking `issuance` would serialise every accrual on the platform.
- `PointsLedgerService.close(personId, at)` — the personal-data-lifecycle seam (EARS-31): sets `closed_at` once; postings are untouched, no reserve is released and no obligation settled.
- Refusals are `PointsLedgerError` (RFC 7807 body via `toProblemDetails`).

## Invariants the database enforces

- Postings are immutable: a `BEFORE UPDATE OR DELETE` trigger refuses every row, and the same for `points_posting_keys` (EARS-27, EARS-4).
- `points_postings` is `PARTITION BY RANGE (occurred_at)`, monthly partitions 2026-01..2027-12 + DEFAULT, pg_partman from 2028-01; unique (`event_id`, `leg`, `occurred_at`); `rule_id` / `rule_version` NOT NULL with a composite FK to `points_rule_versions`; `amount > 0`; `occurred_at <= recorded_at + interval '1 day'` (a far-future posting would sit in DEFAULT and block partition creation); an insert trigger requires a denomination on `attention_points` postings and one unit per posting.
- A balance is a fold `Σ credits − Σ debits` per (account, denomination) — there is no balance column.

## Not here yet

Rule evaluation and the default rule book (#3808), reserves/spend/obligations (#3810), leaderboard (#3812), HTTP reads (#3813), corrections and aggregates (#3814). `points_rule_versions` exists as a table only; no publish API and no seeded rule. No expiry posting exists anywhere (EARS-22). There is no HTTP controller in this module.
