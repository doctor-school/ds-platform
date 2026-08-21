# `@ds/db`

The DS Platform **data layer** — the **Drizzle ORM** schema (SSOT) plus the
`createDrizzle` connection factory (ADR-0003). **Postgres 17 + pgvector**.
Consumed by `@ds/api`; the schema here is the single source of truth for
migrations (`drizzle-kit` in `apps/api` points at this package's config).

## Public surface

Two subpath exports (see `package.json` `exports`), compiled to `dist/`:

```ts
import { createDrizzle } from "@ds/db"; // connection factory
import * as schema from "@ds/db/schema"; // Drizzle table definitions (SSOT)
```

- `.` — the `createDrizzle` factory (and re-exports), plus the edit-audit registries
  `AUDIT_PD_COLUMNS` / `AUDIT_CAPTURE_ALLOWLIST` (`src/audit.ts`) — the TS mirrors of the
  SQL-side lists baked into the spec-010 `audit_pd_columns()` / trigger-attach migration;
  parity between the two is pinned by an e2e test (`apps/api/test/db/universal-edit-audit.e2e-spec.ts`).
  Also `withAuditContext(db, {actorSub, source}, fn)` (`src/audit-context.ts`, spec-010
  EARS-3/EARS-5) — the transaction wrapper that sets the per-tx `app.actor_sub` / `app.source`
  GUCs (`SET LOCAL`) the capture trigger reads to attribute a `data.*` ledger row; a write that
  skips it degrades to `source = 'db-direct'`, actor NULL (EARS-4).
- `./schema` — the table/column definitions consumed by migrations and the API.

`drizzle.config.ts` is the migration config `@ds/api`'s `drizzle:generate` /
`drizzle:migrate` scripts resolve against.

## Retained-row classification

**ADR-0003 design §3.6** is normative for every application-owned Postgres row:
nothing is ever physically deleted, every application-owned foreign key is
`RESTRICT`/`NO ACTION`, and each table is one of exactly two kinds.

- **Soft-removable / expiring** — carries a lifecycle status column plus a
  nullable `deleted_at`, with a `retired ⇔ deleted_at IS NOT NULL` CHECK (or its
  `expired ⇔ …` equivalent). Removal is the transition, in one transaction;
  restore clears `deleted_at` and returns the row to an active status. Default
  repositories filter `deleted_at IS NULL` and a partial index serves that path.
- **Immutable / append-only** — declares that removal is **unsupported**. These
  tables carry NO lifecycle columns _on purpose_: the absence is the contract, so
  a reader can tell "not yet modelled" from "deliberately unremovable". The only
  write is `INSERT`.

Three lifecycle vocabularies exist, deliberately not merged — `record_status`
(`active | retired`, `src/schema/lifecycle.ts`) for ordinary domain and
relationship rows; `taxonomy_status` / `recording_status`
(`draft | published | retired`) where the entity also has an editorial
publication workflow; and `*_status` (`active | expired`) for the technical
records whose inactive state is an expiry that CLEARS content rather than a
removal. A table's DOMAIN state machine is a separate axis again: `events.state`
(`draft → published → live → ended → archived`) says where a broadcast is in its
life, `events.record_status` says whether the row is part of the live domain at
all — an `archived` event is a present, readable row.

| Table                | Class                     | Lifecycle columns                           | Why                                                                                                                                                        |
| -------------------- | ------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | soft-removable            | `record_status` + `deleted_at`              | The identity mirror is referenced by audit, consent, registrations and beats; PD erasure (ADR-0009) empties values on the retained row, it never drops it. |
| `events`             | soft-removable            | `record_status` + `deleted_at`              | A withdrawn broadcast keeps its id and slug so a bookmarked URL can never resolve to a different event (§3.6 rule 5).                                      |
| `event_speakers`     | soft-removable            | `record_status` + `deleted_at`              | Relationship-shaped record (§3.6 rule 4): dropping a speaker from the list retires the row, preserving that this person was announced for this broadcast.  |
| `stream_config`      | soft-removable            | `record_status` + `deleted_at`              | One retained row per event: "no stream any more" is a retirement, and re-configuring is the explicit restore of the same row, never a delete-then-insert.  |
| `registrations`      | soft-removable            | `record_status` + `deleted_at`              | Wave 1 has no cancel command, so every row is `active`; the columns exist so cancellation lands as an ordinary transition instead of a future reshape.     |
| `event_recordings`   | soft-removable            | `recording_status` + `deleted_at`           | Editorial publication workflow (014) — already conforming.                                                                                                 |
| `projects`           | soft-removable            | `taxonomy_status` + `deleted_at`            | Editorial publication workflow (012) — already conforming.                                                                                                 |
| `experts`            | soft-removable            | `taxonomy_status` + `deleted_at`            | Editorial publication workflow (012), plus `content_removed_at` for §2.4 editorial removal — already conforming.                                           |
| `topics`             | soft-removable            | `taxonomy_status` + `deleted_at`            | Editorial publication workflow (012) — already conforming.                                                                                                 |
| `idempotency_keys`   | expiring (retained key)   | `status` (`active\|expired`) + `deleted_at` | Expiry CLEARS the payload and keeps the key forever, so a second actor can never re-use a UUID to replay someone else's command — already conforming.      |
| `media_cleanup_jobs` | expiring (retained job)   | `status` (`active\|expired`) + `deleted_at` | Terminal jobs are cleared to id + kind + outcome + timestamps and retained as the record that the obligation was discharged — already conforming.          |
| `presence_beats`     | **immutable/append-only** | none — by contract                          | Telemetry stream (§3.6 rule 4). A beat is a measurement of a moment that happened; a removal path would be a way to make sponsor minutes vanish unaudited. |
| `consent_records`    | **immutable/append-only** | none — by contract                          | Legal evidence. Withdrawal appends a NEW record (ADR-0009); the old one must stay readable to answer whether past processing was lawful at the time.       |
| `audit_ledger`       | **immutable/append-only** | none — by contract                          | Evidentiary ledger (ADR-0003 §2.7): `INSERT`-only, enforced by a DB trigger on the partitioned parent; corrections are compensating records.               |

Adding a table means adding a row here and picking a class — there is no third
option, and "no lifecycle yet" is not one of them.

## Build / test

```bash
pnpm --filter @ds/db build      # tsc -b → dist/
pnpm --filter @ds/db typecheck  # tsc --noEmit
pnpm --filter @ds/db test       # vitest run
pnpm --filter @ds/db clean      # rm -rf dist .tsbuildinfo
```

## Owning ADR

- **ADR-0003** — data layer stack (Postgres + Drizzle + pgvector).
