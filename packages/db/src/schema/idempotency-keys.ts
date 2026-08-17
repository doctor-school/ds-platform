import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// The retained idempotency-record contract (012-design §6, EARS-17). #1283 — the
// first 012 mutation and the first 012 upload — extends the plain 007-shaped
// table into the full retained record every later taxonomy handler consumes
// unchanged: actor/route binding, request fingerprint, stored response, fenced
// `lease_epoch`, retained `active | expired` lifecycle and a 24-hour expiry that
// CLEARS content instead of deleting the row.
//
// Why the row survives its content: `key` is globally reserved across actors,
// methods, routes and expiry (§6). Deleting an expired row would let a second
// actor re-use the same UUID and replay someone else's command — so expiry is an
// UPDATE that nulls every payload column and permanently keeps the key.
//
// Feature-010 audit exclusion: a technical request-dedup record carries no
// domain truth. It is one of the two explicitly allowlisted technical tables
// (`packages/db/src/audit.ts`), with SQL⇄TS parity tests.

/** Work state of the owning request (§6). Retained through expiry. */
export const idempotencyExecutionState = pgEnum(
  "idempotency_execution_state",
  ["processing", "completed"],
);

/** Retained record lifecycle: `expired` is the cleared, replay-closed shape. */
export const idempotencyRecordStatus = pgEnum("idempotency_record_status", [
  "active",
  "expired",
]);

/** The retained-record window (§6): 24 hours from creation. */
export const IDEMPOTENCY_TTL_HOURS = 24;

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /**
     * The canonical lowercase UUID text the client sent — globally unique across
     * actors, methods, routes and expiry. Never deleted, reactivated or reused.
     */
    key: text("key").primaryKey(),
    scope: text("scope").notNull(),
    /**
     * The acting admin's subject. Replay is permitted only to the ORIGINAL actor
     * on the ORIGINAL route; anyone else gets 409 `IDEMPOTENCY_KEY_REUSED`.
     * Cleared at expiry.
     */
    actorId: text("actor_id"),
    /** HTTP method of the owning request; cleared at expiry. */
    method: text("method"),
    /** Concrete route template of the owning request; cleared at expiry. */
    route: text("route"),
    /**
     * SHA-256 over concrete path/query, canonical JSON, `If-Match`,
     * `Lifecycle-Impact-Token`, the uploaded file's SHA-256 + byte length and
     * `media_profile_version` (§6). Immutable once bound: a retry whose
     * fingerprint differs is 409 `IDEMPOTENCY_KEY_REUSED` BEFORE normalization
     * or upload, so two byte-different files that would normalize identically
     * stay two different requests. Cleared at expiry.
     */
    requestFingerprint: text("request_fingerprint"),
    /** Stored deterministic outcome — successes, 409 invariants and both 412s. */
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    /** Allow-listed response headers only (§6) — never the whole header set. */
    responseEtag: text("response_etag"),
    responseLocation: text("response_location"),
    executionState: idempotencyExecutionState("execution_state")
      .notNull()
      .default("processing"),
    /**
     * Monotonic request fence. An exact-input retry takes the record over by
     * CAS-acquiring a NEWER epoch; a zero-row fenced update rolls back every
     * domain/audit/record write of the stale owner.
     */
    leaseEpoch: integer("lease_epoch").notNull().default(1),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /**
     * Deterministic record-scoped object locator of an upload this record owns.
     * Retained past expiry until the quiescent reconciler acknowledges absence
     * (§6), THEN cleared — that is what makes a late old-owner PUT visible to a
     * later sweep instead of leaking an orphan forever.
     */
    cleanupObjectKey: text("cleanup_object_key"),
    status: idempotencyRecordStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "idempotency_keys_expired_iff_deleted",
      sql`(${t.status} = 'expired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    // An active record always carries its binding — the fingerprint check can
    // never degrade to "no binding recorded, accept anything".
    check(
      "idempotency_keys_active_is_bound",
      sql`${t.status} <> 'active' OR (
        ${t.method} IS NOT NULL
        AND ${t.route} IS NOT NULL
        AND ${t.requestFingerprint} IS NOT NULL
      )`,
    ),
    // Expiry CLEARS content (§6): actor, request, response and lease payload are
    // null on every expired row, while the key and terminal enums/timestamps
    // remain forever. The CHECK makes the cleared shape the only expressible one.
    check(
      "idempotency_keys_expired_is_cleared",
      sql`${t.status} <> 'expired' OR (
        ${t.actorId} IS NULL
        AND ${t.method} IS NULL
        AND ${t.route} IS NULL
        AND ${t.requestFingerprint} IS NULL
        AND ${t.responseBody} IS NULL
        AND ${t.responseEtag} IS NULL
        AND ${t.responseLocation} IS NULL
        AND ${t.leaseOwner} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
      )`,
    ),
    check("idempotency_keys_lease_epoch_positive", sql`${t.leaseEpoch} >= 1`),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
