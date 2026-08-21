import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { recordStatus } from "./lifecycle.js";

// `citext` (case-insensitive text) is a Postgres extension type, not a native
// drizzle column. The migration prepends `CREATE EXTENSION IF NOT EXISTS citext`
// by hand (drizzle-kit never emits CREATE EXTENSION) — same pattern as `vector`
// in 0000_initial.sql. Case-insensitive email matching closes the duplicate-
// account / enumeration seam called out in ADR-0001 §3.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// Domain mirror of the Zitadel identity (003-design §5). `apps/api` (the BFF)
// owns this row; Zitadel owns the credential. `zitadel_sub` is the join key back
// to the IdP. At least one of email / phone must be present (ADR-0001 §3).
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    zitadelSub: text("zitadel_sub").notNull().unique(),
    email: citext("email").unique(),
    phone: text("phone").unique(),
    // Display name SSOT (006-design §11). Nullable — collected just-in-time at
    // first webinar-room entry via the JIT prompt (EARS-14), never at
    // registration. No backfill: existing users hit the prompt on first entry.
    // Served only to the owner's own session (EARS-16); never in chat payloads.
    displayName: text("display_name"),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    role: text("role").notNull().default("doctor_guest"),
    // Soft-delete flag (EARS-19 reconcile depth, #753). Null = active; a
    // timestamp = the mirror row was deactivated because Zitadel (the identity
    // SoT) reported the user removed or inactive. The row is NEVER hard-deleted:
    // `audit_ledger` / `consent_records` / `registrations` / sessions reference
    // `users` (the audit trail must survive) and the `users_email_or_phone`
    // CHECK requires identifiers to persist. This is a downstream projection
    // flag, NOT an authz gate — authz stays Zitadel-token-driven (a
    // Zitadel-deactivated user already cannot obtain tokens). Reactivation
    // clears it back to null when the user reappears active in Zitadel.
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    /**
     * #1278 retained-row lifecycle (ADR-0003 design §3.6) — a SEPARATE axis from
     * `deactivated_at`, not a rename of it:
     *
     *   * `deactivated_at` is the IdP MIRROR flag (EARS-19, #753) — Zitadel, the
     *     identity SoT, reported this user removed or inactive. It says nothing
     *     about the platform's own record and is cleared again when the user
     *     reappears active upstream.
     *   * `record_status` / `deleted_at` is the PLATFORM record lifecycle: is
     *     this row part of the live domain at all. Retiring is
     *     `record_status = 'retired'` + `deleted_at = now()` in one transaction.
     *
     * A user row is never physically deleted — `audit_ledger`,
     * `consent_records`, `registrations` and `presence_beats` all reference it
     * with `RESTRICT` FKs (§3.6 rule 4), and the `users_email_or_phone` CHECK
     * requires the identifiers to persist. Erasing the PERSON's data is ADR-0009
     * value erasure on the retained row, orthogonal to this lifecycle (§3.6 rule
     * 6): a readable email behind a set `deleted_at` does not satisfy an erasure
     * request.
     */
    recordStatus: recordStatus("record_status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "users_email_or_phone",
      sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`,
    ),
    check(
      "users_retired_iff_deleted",
      sql`(${t.recordStatus} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    // §3.6 rule 3: every product read path resolves a LIVE mirror row by
    // `zitadel_sub`; the partial index serves exactly that lookup, predicated
    // on `record_status = 'active'` — the expression the readers use, and the
    // only one the planner can match (the `retired ⇔ deleted_at` CHECK does not
    // bridge predicates).
    index("users_active_zitadel_sub_idx")
      .on(t.zitadelSub)
      .where(sql`${t.recordStatus} = 'active'`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
