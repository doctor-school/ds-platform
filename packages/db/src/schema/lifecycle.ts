import { pgEnum } from "drizzle-orm/pg-core";

// #1278 — the shared retained-row lifecycle vocabulary for every
// application-owned table that is NOT a taxonomy entity (ADR-0003 design §3.6).
//
// §3.6 splits every application-owned table in two:
//
//   * **soft-removable / expiring** — the row carries a lifecycle `record_status`
//     plus a nullable `deleted_at`, and "removal" is the transition
//     `record_status = 'retired'` + `deleted_at = now()` in ONE transaction,
//     pinned by a `retired ⇔ deleted_at IS NOT NULL` CHECK. Nothing is ever
//     physically deleted; a restore clears `deleted_at` and returns the row to
//     `'active'` (§3.6 rules 1–2).
//   * **immutable / append-only** — telemetry and evidence streams
//     (`presence_beats`, `consent_records`, `audit_ledger`). They carry NO
//     lifecycle columns on purpose: there is no removal transition to express,
//     so the contract is declared explicitly in the table's own doc comment and
//     the absence of a mutable column IS the guard.
//
// The classification of every table lives in `packages/db/README.md` →
// "Retained-row classification"; that table is the artifact reviewers read, this
// enum is the vocabulary it is written in.
//
// Deliberately a SEPARATE type from `taxonomy_status`
// (draft/published/retired): 012's taxonomy rows model an editorial publication
// workflow, whereas these tables model only presence-vs-removal. Merging the two
// would put a `draft` state on a registration and a `published` state on a
// stream config, neither of which is meaningful. It is likewise separate from a
// table's DOMAIN state machine (`events.state`
// draft→published→live→ended→hidden, 007 EARS-7): a hidden event is still a
// present row, a retired one is a removed row, and the two axes move
// independently — which is why the column is named `record_status`, never
// `status`.
export const recordStatus = pgEnum("record_status", ["active", "retired"]);
