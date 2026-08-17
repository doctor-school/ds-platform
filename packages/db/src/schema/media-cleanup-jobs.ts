import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 012 — the durable old-reference cleanup obligation (012-design §5.1, §6;
// introduced by #1283 with the first upload). When a committed media replace or
// clear releases a previously referenced object, the SAME transaction that swaps
// the domain ref inserts one `active`/`pending` job here. That is why a storage
// outage can never silently strip a doctor-visible cover: the content mutation
// commits, the deletion obligation is durable, and a leased worker finishes it.
//
// This is a CONSTRAINED TECHNICAL table, not domain truth — it is one of the two
// explicit feature-010 audit exclusions (the other is `idempotency_keys`), named
// in both the SQL and TS allowlists with parity tests (`packages/db/src/audit.ts`).

/** Retained lifecycle of a cleanup job — `expired` is the terminal, cleared shape. */
export const mediaCleanupStatus = pgEnum("media_cleanup_status", [
  "active",
  "expired",
]);

/** Work state inside the `active` window (012-design §5.1). */
export const mediaCleanupExecutionState = pgEnum(
  "media_cleanup_execution_state",
  ["pending", "processing", "completed"],
);

/** Why the reference was released. */
export const mediaCleanupKind = pgEnum("media_cleanup_kind", [
  /** A new upload replaced the old reference. */
  "replace",
  /** `mediaAction: "clear"` dropped the reference. */
  "clear",
  /** The §2.4 editorial removal released the reference (#1306). */
  "content_removal",
]);

/** Which taxonomy entity kind owned the released reference. */
export const mediaEntityKind = pgEnum("media_entity_kind", [
  "project",
  "expert",
  "partner",
]);

/** The kind-specific media slot the reference occupied. */
export const mediaSlot = pgEnum("media_slot", ["cover", "photo", "logo"]);

/**
 * Enum-only last error (012-design §5.1) — never free-text provider output, so
 * a retained technical row cannot accumulate leaked keys or PII.
 */
export const mediaCleanupError = pgEnum("media_cleanup_error", [
  "object_storage_unavailable",
  "cdn_unavailable",
  "still_referenced",
  "unknown",
]);

export const mediaCleanupJobs = pgTable(
  "media_cleanup_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: mediaCleanupStatus("status").notNull().default("active"),
    executionState: mediaCleanupExecutionState("execution_state")
      .notNull()
      .default("pending"),
    cleanupKind: mediaCleanupKind("cleanup_kind").notNull(),
    entityKind: mediaEntityKind("entity_kind").notNull(),
    /** Cleared on completion — the terminal row keeps no entity linkage. */
    entityId: uuid("entity_id"),
    slot: mediaSlot("slot").notNull(),
    /** Server-generated object key of the RELEASED object; cleared on completion. */
    objectKey: text("object_key"),
    /** CDN key/path to purge or invalidate; cleared on completion. */
    cdnKey: text("cdn_key"),
    /**
     * Monotonic fence. A worker CAS-acquires a NEWER epoch before touching the
     * providers, so a stale owner's late completion updates zero rows and can
     * never declare cleanup done (012-design §5.1).
     */
    leaseEpoch: integer("lease_epoch").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: mediaCleanupError("last_error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "media_cleanup_jobs_expired_iff_deleted",
      sql`(${t.status} = 'expired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    // Terminal shape (012-design §5.1): completion retains ONLY job id, cleanup
    // kind, outcome and timestamps — raw keys, entity linkage, lease and error
    // content are cleared. The CHECK makes that the only expressible `expired`
    // row, so a half-cleared terminal row cannot exist.
    check(
      "media_cleanup_jobs_terminal_is_cleared",
      sql`${t.status} <> 'expired' OR (
        ${t.executionState} = 'completed'
        AND ${t.objectKey} IS NULL
        AND ${t.cdnKey} IS NULL
        AND ${t.entityId} IS NULL
        AND ${t.leaseOwner} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
        AND ${t.lastError} IS NULL
        AND ${t.completedAt} IS NOT NULL
      )`,
    ),
    // An active job must still know what to delete.
    check(
      "media_cleanup_jobs_active_has_locator",
      sql`${t.status} <> 'active' OR (${t.objectKey} IS NOT NULL AND ${t.entityId} IS NOT NULL)`,
    ),
    check("media_cleanup_jobs_lease_epoch_non_negative", sql`${t.leaseEpoch} >= 0`),
    check(
      "media_cleanup_jobs_attempts_non_negative",
      sql`${t.attemptCount} >= 0`,
    ),
  ],
);

export type MediaCleanupJob = typeof mediaCleanupJobs.$inferSelect;
export type NewMediaCleanupJob = typeof mediaCleanupJobs.$inferInsert;
