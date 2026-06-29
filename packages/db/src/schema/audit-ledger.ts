import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// EARS-18 auth-audit ledger (003-design §7.3; ADR-0003 §2.7 append-only ledger,
// §6 audit_ledger; ADR-0001 §7.3 canonical event taxonomy). One row per
// state-changing auth command — the durable sink the F4 in-memory `AuthAuditLog`
// port was a placeholder for.
//
// Native RANGE partitioning (#136, ADR-0003 §2.7/§6): the table is partitioned
// `PARTITION BY RANGE (created_at)` into monthly partitions (named
// `audit_ledger_yYYYY_mMM`) plus a `DEFAULT` safety-net partition. drizzle does
// NOT model `PARTITION BY` — the partition DDL is hand-managed in migration
// `0003_audit_ledger_partitioning.sql` (ADR-0003 §3.4). Postgres requires the
// partition key in every unique/primary-key constraint on a partitioned table,
// so the PK is composite `(id, created_at)` and the `event_id` uniqueness is
// composite `(event_id, created_at)` — i.e. idempotency dedup is scoped within a
// monthly partition (ADR-0003 §2.7 explains why that is acceptable for v1).
//
// Append-only contract (ADR-0003 §2.7): INSERT-only — UPDATE/DELETE are
// prohibited by a DB trigger on the partitioned parent (cascades to every
// partition, migration 0003), not just convention. v1 uses a random UUID pk; the
// timestamp-ordered UUIDv7 + optional `prev_hash` integrity chain are an
// ADR-0003 §2.7 v2 nicety (DSO-30), intentionally not built here.
//
// PD discipline (ADR-0001 §7, ADR-0003 §6): no raw identifier (email/phone) is
// ever stored — only a salted `identifier_hash` inside `metadata` (the writer
// masks before insert). `subject_id` is the opaque Zitadel `sub`, not PD.
export const auditLedger = pgTable(
  "audit_ledger",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Per-event idempotency key (anti-fraud dedup, ADR-0003 §2.7). Unique within a monthly partition. */
    eventId: uuid("event_id").notNull(),
    /** Canonical `auth.<class>.<event>` wire id (ADR-0001 §7.3). */
    eventType: text("event_type").notNull(),
    /** Opaque Zitadel `sub` (not PD). Null for pre-identity events (e.g. a login failure on an unknown identifier). */
    subjectId: text("subject_id"),
    /** Session id, when the event is session-scoped (logout, rotation, reuse). */
    sid: text("sid"),
    /** Discriminating reason where the taxonomy carries one (logout/theft_detected/wrong_password/lock/captcha_failed). */
    reason: text("reason"),
    /** Masked, non-PD context (identifier_hash, method, channel, …). Never raw PD. */
    metadata: jsonb("metadata").notNull().default({}),
    /** Partition key — the table is RANGE-partitioned on this column (monthly). */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite constraints carry the partition key (created_at) — a hard
    // Postgres requirement for unique/primary-key constraints on a partitioned
    // table. Partition DDL itself lives in migration 0003 (drizzle does not
    // model PARTITION BY); these table-level configs keep the snapshot honest.
    primaryKey({
      name: "audit_ledger_pkey",
      columns: [table.id, table.createdAt],
    }),
    unique("audit_ledger_event_id_unique").on(table.eventId, table.createdAt),
  ],
);

export type AuditLedgerRow = typeof auditLedger.$inferSelect;
export type NewAuditLedgerRow = typeof auditLedger.$inferInsert;
