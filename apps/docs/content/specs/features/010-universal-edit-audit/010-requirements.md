---
title: "010 — Universal edit audit: WHO / WHEN / WHAT / SOURCE for every domain-table mutation"
description: "Requirements: a universal, DB-layer edit-audit mechanism — one generic PL/pgSQL row-level AFTER trigger attached to every domain table by migration — so that every INSERT/UPDATE/DELETE of domain data leaves an append-only audit_ledger record answering WHO (actor sub), WHEN, WHAT (field-level before→after diff, changed fields only) and SOURCE (human admin vs automated system function vs direct DB access). Actor/source ride per-transaction GUCs set by the API's Drizzle transaction wrapper; a write with no context still lands as source=db-direct — audited, never blocked. Written once, the mechanism covers all current AND future tables with no per-table re-implementation, and a CI coverage guard makes silent opt-out of a new table/write-path impossible. PD-bearing columns are masked in diffs (ADR-0009 §2.4). Backend-only infra: the admin history-viewer UI is an owner-deferred follow-up feature."
slug: 010-universal-edit-audit
status: In dev
surface: backend-only
tracker: https://github.com/doctor-school/ds-platform/issues/1084
issues: [1086, 1087, 1088, 1089]
prior_decisions:
  - "ADR-0003 — Data Layer (§2.7/§6 append-only audit_ledger — as-built: monthly RANGE partitions via pg_partman, composite PK (id, created_at), UPDATE/DELETE prohibited by DB trigger, corrections are compensating records; design §7 extensions list carries pgaudit only as 'under consideration if audit requirements cannot be met at the app level' — 010 meets them at the DB-trigger level, so pgaudit stays rejected)"
  - "ADR-0001 §7.3 — canonical event taxonomy (identity-auth-rbac-design §7.3 owns the two-level <class>.<event> wire-id scheme; 010 extends it with the data.<table>.<insert|update|delete> namespace for domain-data mutations)"
  - "ADR-0009 — PD Lifecycle (§2.4 audit_ledger + erasure compatibility: subject-identifying values in audit rows must not be stored in plaintext — v1 masks PD-column values in diffs; per-subject-key encryption of masked values is a named tracked follow-up aligned with the §2.4 Vault contract; §2.4/§2.6 retention matrix: audit_ledger 5y, crypto-shred at term)"
  - "ADR-0002 — Backend Core Stack (§3 NestJS + nestjs-zod, Vitest; the audit context wrapper lives in the API's Drizzle transaction layer; packages/db owns the schema + migrations)"
  - ADR-0006 §4 — Documentation & SSOT (feature-spec triplet + flat EARS numbering)
lang: en
---

# 010 — Universal edit audit: WHO / WHEN / WHAT / SOURCE for every domain-table mutation (Requirements)

> **Surface: backend-only** — this spec ships no screen. The admin history-viewer UI over the audit trail is an **owner-deferred follow-up feature** (Scope → Out of scope), not a silent default. No PRD exists (infra path per ADR-0014 legacy carve-out) — EARS clauses carry no `realizes:` backlinks. Initiative: [#1084](https://github.com/doctor-school/ds-platform/issues/1084).

## Outcomes

- **Every mutation of a domain table leaves a durable audit record.** Any INSERT / UPDATE / DELETE of a row in a domain table — regardless of the code path that produced it (admin UI command, portal API, background job, migration, a DBA at a psql prompt) — appends exactly one record to the existing append-only `audit_ledger` (ADR-0003 §2.7/§6) answering **WHO** (actor), **WHEN** (timestamp), **WHAT** (field-level before→after diff) and **SOURCE** (human admin vs automated system function vs direct DB access).
- **The mechanism is universal — written once.** One generic capture mechanism covers all current **and future** tables and fields with no per-table re-implementation: adding a table costs one trigger-attach line in its migration, nothing else.
- **No write path can silently opt out.** A CI coverage guard asserts every domain table has the audit trigger attached; a new table without it (and without an explicit allowlist entry) turns CI red — universality is enforced, not hoped for.
- **The trail is trustworthy.** Audit rows inherit the ledger's append-only contract (no UPDATE/DELETE, corrections are compensating records) and its 5-year retention with crypto-shred at term (ADR-0009 §2.4/§2.6); PD-bearing values never appear in a diff in plaintext (ADR-0009 §2.4).
- **The platform can answer the operational question that motivated the feature:** "who changed this field on this record, when, from what, and through which door" — for any domain row, including changes made outside the application.

## Scope

**In:**

- **DB-layer capture** — one generic PL/pgSQL row-level `AFTER INSERT OR UPDATE OR DELETE` trigger function, attached to each domain table by migration; fires per affected row, computes the diff, and appends one `audit_ledger` row inside the same transaction (EARS-1).
- **Field-level diff, changed fields only** — for UPDATE the diff carries only fields whose value actually changed (`IS DISTINCT FROM`), as `{field: {old, new}}`, excluding the bookkeeping column `updated_at`; INSERT captures the full new row (`{field: {new}}`); DELETE captures the **full old row** (`{field: {old}}`) so a deleted record remains reconstructible (EARS-2).
- **Actor/source propagation from the API** — the API sets per-transaction GUCs via `SET LOCAL` (`app.actor_sub` = the Zitadel `sub`; `app.source` ∈ `admin-ui | portal-api | system:<job-name> | migration | manual-dba`) from request context inside a Drizzle transaction wrapper; the trigger reads them with `current_setting(..., true)` (EARS-3).
- **Graceful degradation for context-less writes** — a write reaching the table with no audit context (direct psql, an unwrapped script) is **still audited**: the row is written with `source = 'db-direct'` and a NULL actor. Missing context never blocks the domain write (EARS-4).
- **API-path actor guarantee** — every authenticated mutating API request runs inside the audit-context transaction wrapper, so a `data.*` ledger row originating from the API always carries the real actor `sub` and a concrete source — this guarantee is its own requirement with its own test, not a side effect (EARS-5).
- **Storage contract on the existing ledger** — reuse `audit_ledger` as-built (no new table): new eventType namespace `data.<table>.<insert|update|delete>` extending the ADR-0001 §7.3 taxonomy; `subject_id` = actor sub; `metadata` = `{table, pk, diff, source, txid}`; append-only + partitioning + 5y retention inherited (EARS-6).
- **PD masking in diffs** — on PD-bearing tables (as-built: `users`, `consent_records`; henceforth any table the ADR-0009 retention matrix classifies as PD-bearing), values of PD columns are **masked** in the diff: the field name is recorded with `masked: true`, `old`/`new` omitted (EARS-7).
- **Coverage guard** — a `tools/lint/` CI check asserting every table in the `packages/db` schema has the audit trigger attached in migrations, with an explicit rationale-carrying allowlist (`audit_ledger` itself; derived/cache/telemetry tables); red on any new unlisted table (EARS-8).
- **Migrations** — the trigger function + per-table attach statements as hand-managed SQL in the `packages/db` migration chain (same pattern as the ledger's own partition DDL, ADR-0003 §3.4).

**Explicitly out** (each a named deferral, not a silent default):

- **Admin history-viewer UI** — the screen that renders a record's change history to an operator is an **owner-deferred follow-up feature** (owner decision, 2026-07-17). 010 makes the trail _queryable_ (SQL over `audit_ledger`); it ships no viewer. This deferral is why `surface: backend-only` is honest — no EARS in this spec has a UI trigger or deliverable.
- **Retro-backfill** — edits made before this feature ships are not reconstructed; the trail starts at trigger attachment.
- **Read auditing** — SELECT/access auditing is out entirely; 010 audits mutations only.
- **Per-subject-key encryption of masked PD diff values** — v1 masks (field name + `masked: true`, values omitted); storing the masked values encrypted with the per-subject Vault key (the ADR-0009 §2.4 contract) so an authorized investigation can recover them is a **tracked follow-up** Issue opened by `open-ears-issues` (a real-dependency done-criterion: the §2.4 per-subject key infrastructure).
- **Integrity hash chain** — `prev_hash` chaining remains the ADR-0003 §2.7 v2 nicety (DSO-30); 010 does not build it.
- **Statement-level / server-log auditing (`pgaudit`)** — rejected, see Prior decisions.

## Constraints

- **Capture at the DB layer, not the app layer.** The trigger is the only place that sees _every_ write path — ORM, raw SQL, migrations, a psql session. An app-layer (Drizzle wrapper) capture was rejected: it misses direct-DB and migration writes, which are exactly the SOURCE classes the owner asked to distinguish (design §6).
- **One generic function, per-table attachment.** The trigger function is written once, table-agnostic (reads `TG_TABLE_NAME`, iterates columns via row-to-jsonb); tables opt **in** by a one-line `CREATE TRIGGER` in their migration, and the coverage guard makes opting in mandatory (EARS-1, EARS-8).
- **Audit is in-transaction and fail-closed for the append itself.** The ledger append runs inside the mutating transaction: if the append genuinely cannot be written (ledger unavailable, constraint failure), the transaction fails — **no unaudited domain mutation ever commits**. The _graceful_ path (EARS-4) covers missing context only, never a failed append. This is the same posture as the no-silent-opt-out guard, applied at runtime.
- **Audit never invents identity.** The trigger records the actor only when the transaction carries one (`app.actor_sub` GUC); it never guesses. Absent context ⇒ `source = 'db-direct'`, actor NULL — visible honesty, not fabricated attribution (EARS-4).
- **No plaintext PD in the ledger — ever.** ADR-0009 §2.4 is a hard constraint: `subject_id` stays the opaque Zitadel `sub` (not PD, per the as-built ledger contract), and PD-column values are masked out of diffs (EARS-7). The existing writer-side masking discipline (`identifier_hash`, never raw email/phone) is unchanged.
- **Reuse the as-built ledger, change nothing structural.** `audit_ledger` as shipped (composite PK `(id, created_at)`, monthly RANGE partitions + DEFAULT partition, pg_partman, append-only enforcement trigger, `event_id` dedup unique within a partition) is used as-is; 010 adds a new eventType namespace and a metadata shape, no columns and no new table (EARS-6).
- **`source` is a closed set, extended by migration.** `admin-ui | portal-api | system:<job-name> | migration | manual-dba` set explicitly by the writer, plus the trigger-side fallback `db-direct`. An unknown/free-form source string is a defect, not a feature.
- **High-stakes performance honesty.** The trigger adds one JSONB comparison + one INSERT per mutated row. Domain tables here are low-write-rate (events, registrations, users); the two high-volume append streams (`presence_beats`) and technical tables (`idempotency_keys`) are allowlist candidates precisely because auditing them would duplicate a telemetry stream 1:1 for no WHO/WHAT gain — each allowlist entry carries a recorded rationale (EARS-8).
- **Stack** (ADR-0002/ADR-0003): trigger + attachments live in `packages/db` migrations (hand-managed SQL); the transaction wrapper lives in the API's Drizzle layer; tests are Vitest (unit + e2e against dev-stand Postgres, `skipIf(!DATABASE_URL)`); the coverage guard is a `tools/lint/*.ts` check wired into CI like its siblings.

## Prior decisions

- **ADR-0003 §2.7/§6 + design §7** — the append-only ledger exists, partitioned and enforcement-triggered; `pgaudit` was left "under consideration if ADR-0001 audit requirements cannot be met at the app level" — 010 resolves that consideration **against** pgaudit: server-log statement auditing is not a queryable, per-row, diff-carrying ledger and cannot answer WHAT at field level. The DB-trigger ledger meets the requirement, so pgaudit stays out.
- **ADR-0001 §7.3** (canonical taxonomy owned by identity-auth-rbac-design §7.3) — the two-level `<class>.<event>` scheme (`auth.*` as-built) is extended with a three-level domain-data namespace `data.<table>.<insert|update|delete>`. The table segment makes the namespace self-extending: a new audited table needs no taxonomy edit.
- **ADR-0009 §2.4** — erasure compatibility: subject-identifying data in audit rows must be erasable without breaking the ledger. v1 masking (no plaintext PD in diffs) satisfies this trivially — there is nothing to erase from a diff; the encrypted-masked-values follow-up must re-satisfy it via the per-subject Vault key. §2.4/§2.6: `audit_ledger` retention 5y (НК РФ + medical compliance), crypto-shred at term — `data.*` rows inherit it.
- **ADR-0002 §3** — NestJS request context (authenticated principal) is the actor source; the Drizzle transaction wrapper is the propagation seam; Vitest is the verification harness.
- **ADR-0006 §4** — triplet structure, flat EARS numbering.

## Event Model

010 is **write-path infrastructure**: it introduces no domain command of its own — its "commands" are the mutations other features already perform. It owns the capture trigger, the context-propagation wrapper, the `data.*` ledger namespace, and the coverage guard.

### Commands

- _(internal seam, not an endpoint)_ `withAuditContext(actor, source, fn)` — the Drizzle transaction wrapper: opens a transaction, issues `SET LOCAL app.actor_sub = <sub>` + `SET LOCAL app.source = <source>`, runs the domain mutation inside it. Every authenticated mutating API handler runs through it (EARS-3, EARS-5).
- All existing/future domain commands (e.g. 007's `UpdateEvent`, 005's `RegisterForEvent`) are unchanged — the trigger observes their effects; they adopt the wrapper, not a new API.

### Events

| Event (ledger `event_type`) | Producer                    | Notes                                                                                                         |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `data.<table>.insert`       | DB trigger (any write path) | Full new row in `metadata.diff` as `{field: {new}}`; PD columns masked (EARS-7).                              |
| `data.<table>.update`       | DB trigger (any write path) | Changed fields only, `{field: {old, new}}`, `updated_at` excluded; a no-op UPDATE (empty diff) writes no row. |
| `data.<table>.delete`       | DB trigger (any write path) | Full old row in `metadata.diff` as `{field: {old}}` — the deleted record stays reconstructible (EARS-2).      |

Common row shape: `subject_id` = actor sub (NULL when context-less); `metadata` = `{table, pk, diff, source, txid}`; `created_at` = mutation time (partition key); `event_id` = trigger-generated UUID (per-row, dedup within partition as-built).

### Read models

- **Audit trail (SQL-queryable, no UI in 010)** — "history of row X": `SELECT ... WHERE event_type LIKE 'data.<table>.%' AND metadata->>'pk' = <pk> ORDER BY created_at`; "everything actor Y touched": filter on `subject_id`. The deferred admin viewer (Out of scope) will read exactly this projection.
- **Coverage report** — the guard's output: the set of schema tables × (trigger attached | allowlisted | **violation**) (EARS-8).

### Policies

- **On any INSERT/UPDATE/DELETE of an audited domain table** → append one `data.<table>.<op>` ledger row in the same transaction, with diff per op-kind rules (EARS-1, EARS-2).
- **On an authenticated mutating API request** → the handler runs inside `withAuditContext`; the resulting ledger rows carry the actor sub + concrete source (EARS-3, EARS-5).
- **On a write with no audit context** → still append, `source = 'db-direct'`, actor NULL; never block the domain write for missing context (EARS-4).
- **On a diff touching a PD column** → mask: record the field name + `masked: true`, omit values (EARS-7).
- **On CI, for every `packages/db` schema table** → assert trigger attached in the migration chain, or an explicit allowlist entry with rationale; else red (EARS-8).

## EARS requirements

> **Numbering:** flat (`EARS-1`, …) per ADR-0006 §4. No `realizes:` backlinks — no PRD exists (infra path). No EARS trigger references a UI surface (`surface: backend-only` is valid under the anti-hide guard).

- **EARS-1 — Universal DB-layer capture.** When a row of an audited domain table is inserted, updated, or deleted — through **any** write path (ORM, raw SQL, migration, direct DB session) — the system shall append exactly one `audit_ledger` row for that mutated row, produced by **one generic PL/pgSQL row-level AFTER trigger function** attached to the table by migration, inside the same transaction as the mutation; the function shall be table-agnostic (no per-table code), so covering a new table costs only its trigger-attach migration line.
- **EARS-2 — Field-level diff.** When the trigger records a mutation, the system shall store a JSONB diff in `metadata.diff` computed as: for UPDATE — **only fields whose value actually changed** (`IS DISTINCT FROM`), each as `{field: {old, new}}`, with the bookkeeping column `updated_at` excluded (an UPDATE whose diff is empty after exclusions shall write **no** ledger row); for INSERT — the full new row as `{field: {new}}`; for DELETE — the **full old row** as `{field: {old}}`.
- **EARS-3 — Actor/source propagation.** When an authenticated API request performs a domain mutation, the system shall execute it inside a Drizzle transaction wrapper that issues `SET LOCAL app.actor_sub = <Zitadel sub>` and `SET LOCAL app.source = <source>` with `source` from the closed set `admin-ui | portal-api | system:<job-name> | migration | manual-dba`; the trigger shall read both via `current_setting(..., true)` and record them on the ledger row (`subject_id` = actor sub; `metadata.source` = source).
- **EARS-4 — Context-less writes still audited, never blocked.** When a mutation reaches an audited table with no audit context set (e.g. a direct DB session or an unwrapped script), the system shall still append the ledger row with `metadata.source = 'db-direct'` and `subject_id` NULL; the absence of context shall never cause the domain write to fail, and the trigger shall never fabricate an actor.
- **EARS-5 — API-path actor guarantee.** The system shall ensure every authenticated mutating API endpoint runs its domain writes inside the EARS-3 wrapper, so that a `data.*` ledger row originating from an authenticated API request **always** carries a non-NULL actor sub and a concrete non-`db-direct` source — an authenticated mutation surfacing as `db-direct` is a defect.
- **EARS-6 — Storage contract on the existing ledger.** The system shall store audit records in the existing `audit_ledger` (ADR-0003 §2.7/§6 as-built — monthly RANGE partitions, pg_partman, composite PK, append-only enforcement trigger) with `event_type = data.<table>.<insert|update|delete>` (extending the ADR-0001 §7.3 taxonomy), `subject_id` = actor sub, and `metadata = {table, pk, diff, source, txid}` (`txid` = `txid_current()`, grouping all rows of one transaction); `data.*` rows shall inherit the ledger's append-only contract (UPDATE/DELETE refused by the enforcement trigger; corrections are compensating records) and the ADR-0009 §2.4/§2.6 retention (5y, crypto-shred at term).
- **EARS-7 — PD masking in diffs.** When the diff for a mutation on a PD-bearing table (as-built: `users`, `consent_records`; any future table the ADR-0009 retention matrix classifies as PD-bearing) touches a PD column, the system shall record that field in the diff as `{field: {masked: true}}` — **no plaintext old/new value of a PD column shall ever be stored** in a ledger diff (ADR-0009 §2.4); non-PD columns of the same row diff normally. Per-subject-key encryption of masked values is a named tracked follow-up, not part of this clause.
- **EARS-8 — Coverage guard: no silent opt-out.** The system shall provide a `tools/lint/` CI check that asserts, for **every** table declared in the `packages/db` schema, that the audit trigger is attached in the migration chain **or** the table appears on an explicit allowlist entry carrying a recorded rationale (initial allowlist: `audit_ledger` itself — recursion; derived/cache/telemetry tables per design §5); the check shall fail red when any new table is neither triggered nor allowlisted, so a future table or write-path cannot silently opt out of auditing.

## Invariants

- Every committed mutation of an audited domain table has exactly one corresponding `data.<table>.<op>` ledger row in the same transaction — **no unaudited domain mutation ever commits** (EARS-1; fail-closed append, Constraints).
- A ledger diff never contains a plaintext PD-column value (EARS-7; ADR-0009 §2.4).
- `data.*` rows are append-only: UPDATE/DELETE on them is refused by the ledger's enforcement trigger; the trail can be extended, never rewritten (EARS-6).
- An authenticated API mutation always yields an attributed row (actor sub + concrete source); `db-direct` appears only for genuinely context-less writes (EARS-4, EARS-5).
- The set {audited tables} ∪ {allowlisted tables} always equals the full `packages/db` schema table set — enforced red/green in CI, not by convention (EARS-8).
- The trigger function is single and generic; there is no per-table capture code to drift (EARS-1).
- `updated_at` never appears in a diff; an effect-free UPDATE leaves no trail row (EARS-2).

## Verification

> `surface: backend-only` ⇒ Vitest e2e (dev-stand Postgres) + unit is complete coverage; **no browser/E2E row** (per author-ears-spec). DB-dependent tests `skipIf(!process.env.DATABASE_URL)`.

| EARS | Test type         | File (indicative)                                     | Notes                                                                                                                                                                                                                                                 |
| ---- | ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Vitest e2e (db)   | `packages/db/test/audit-trigger.e2e-spec.ts`          | `it('EARS-1: ...')` INSERT/UPDATE/DELETE on an audited table each append exactly one `data.<table>.<op>` row in the same transaction; one generic function serves two different tables with zero per-table code.                                      |
| 2    | Vitest e2e + unit | `packages/db/test/audit-diff.e2e-spec.ts`             | UPDATE diff carries changed fields only (`{old, new}`), excludes `updated_at`; no-op UPDATE writes no row; INSERT captures `{new}` for the full row; DELETE captures the **full old row** as `{old}`.                                                 |
| 3    | Vitest e2e (api)  | `apps/api/test/audit/context-propagation.e2e-spec.ts` | An authenticated API update lands a ledger row with `subject_id` = the caller's Zitadel sub and the correct `metadata.source` (e.g. `portal-api`); `skipIf(!DATABASE_URL \|\| !IDP_ISSUER)`.                                                          |
| 4    | Vitest e2e (db)   | `packages/db/test/audit-db-direct.e2e-spec.ts`        | A raw SQL write with no GUCs set succeeds AND lands a row with `metadata.source = 'db-direct'`, `subject_id` NULL — audited, not blocked, not attributed.                                                                                             |
| 5    | Vitest e2e + unit | `apps/api/test/audit/api-actor-guarantee.e2e-spec.ts` | Sweep of authenticated mutating endpoints: every resulting `data.*` row has a non-NULL actor + non-`db-direct` source; unit test pins the wrapper seam so an unwrapped handler fails the suite.                                                       |
| 6    | Vitest e2e (db)   | `packages/db/test/audit-storage-contract.e2e-spec.ts` | Row shape: `event_type` matches `data.<table>.<insert\|update\|delete>`; `metadata` carries `{table, pk, diff, source, txid}`; two rows of one transaction share `txid`; UPDATE/DELETE against a `data.*` row is **refused** (append-only inherited). |
| 7    | Vitest e2e (db)   | `packages/db/test/audit-pd-masking.e2e-spec.ts`       | An UPDATE touching a PD column on `users`/`consent_records` yields a diff entry `{masked: true}` with no `old`/`new`; non-PD columns in the same diff carry values; a plaintext PD value anywhere in the row fails the assertion.                     |
| 8    | Guard unit test   | `tools/lint/guard-tests/audit-coverage-lint.spec.ts`  | The coverage guard goes **red** on a fixture schema table with no trigger attachment and no allowlist entry; green when triggered or allowlisted-with-rationale; the live repo state passes.                                                          |
| all  | Vitest (CI)       | —                                                     | All rows run in the standard CI Vitest jobs; DB-dependent specs `skipIf` their env — backend-only spec, no browser row by design (F-22 N/A).                                                                                                          |

## Dependencies & sequencing

- **`audit_ledger` as-built (003/#136)** — the storage substrate exists (partitioning, pg_partman, append-only enforcement). 010 adds no structural change to it; sequencing risk is nil.
- **Domain tables as-built** — `users`, `consent_records`, `events`, `registrations` (+ `idempotency_keys`, `presence_beats` as allowlist candidates) are the initial attach set; the attach migration enumerates them once, the guard keeps the set complete thereafter.
- **Zitadel principal (003)** — the actor sub comes from the shipped auth layer; 010 adds no auth primitive.
- **Follow-ups opened by `open-ears-issues`:** (1) admin history-viewer UI (owner-deferred feature — future spec, `user-facing`); (2) per-subject-key encryption of masked PD diff values (ADR-0009 §2.4 alignment; real dependency: per-subject Vault key infrastructure).
