import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// EARS-18 auth-audit ledger (003-design §7.3; ADR-0003 §2.7 append-only ledger,
// §6 audit_ledger; ADR-0001 §7.3 canonical event taxonomy). One row per
// state-changing auth command — the durable sink the F4 in-memory `AuthAuditLog`
// port was a placeholder for.
//
// Append-only contract (ADR-0003 §2.7): INSERT-only — UPDATE/DELETE are
// prohibited by a DB trigger (migration 0002), not just convention. `event_id`
// is UNIQUE for idempotent ingest / anti-fraud dedup. v1 uses a random UUID pk;
// the timestamp-ordered UUIDv7 + optional `prev_hash` integrity chain are an
// ADR-0003 §2.7 v2 nicety (DSO-30), intentionally not built here.
//
// PD discipline (ADR-0001 §7, ADR-0003 §6): no raw identifier (email/phone) is
// ever stored — only a salted `identifier_hash` inside `metadata` (the writer
// masks before insert). `subject_id` is the opaque Zitadel `sub`, not PD.
export const auditLedger = pgTable("audit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Per-event idempotency key (anti-fraud dedup, ADR-0003 §2.7). */
  eventId: uuid("event_id").notNull().unique(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLedgerRow = typeof auditLedger.$inferSelect;
export type NewAuditLedgerRow = typeof auditLedger.$inferInsert;
