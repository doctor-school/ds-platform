import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./users.js";

// 003-local minimal consent slice (003-design §5). The full ADR-0009 consent
// subsystem (withdrawal, version migration) supersedes/extends this later — 003
// references, does not own, the subsystem. One row per (purpose, version)
// captured at registration / first-login consent.
//
// **#1278 classification: IMMUTABLE / APPEND-ONLY — removal is unsupported**
// (ADR-0003 design §3.6, rule 4 evidence stream). A consent record is legal
// evidence of what a specific person agreed to, at which version, at one
// instant. Withdrawal does not remove it and does not flip a flag on it — the
// ADR-0009 subsystem appends a NEW record; the withdrawn consent must remain
// readable to answer "was processing lawful at the time it happened". So this
// table deliberately carries NO `record_status` and NO `deleted_at`: there is no
// removal transition to express, and a `retired` state here would be a way to
// make the legal basis for past processing vanish.
//
// The FK is `RESTRICT` (§3.6 rule 4) — the strongest case in the schema for
// killing the old cascade, which let deleting a `users` row destroy the consent
// evidence that outlives the account. A doctor's erasure request is served by
// ADR-0009 value erasure on the `users` mirror, orthogonal to row retention
// (§3.6 rule 6); the consent row itself stores only an opaque user id, a purpose
// and a version — no PD.
/**
 * 044 EARS-35 — how a consent was captured. `paper` is a consent the registrar
 * recorded from a signed paper form at the congress desk; an online consent the
 * subject gave themselves carries `NULL` (every row written before 0040).
 */
export const CONSENT_ORIGINS = ["paper"] as const;
export type ConsentOrigin = (typeof CONSENT_ORIGINS)[number];

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    version: text("version").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * 044 EARS-35 — {@link ConsentOrigin}, or `NULL` for an online consent. The
     * purpose and version are unchanged by it: a paper consent is the same
     * accepted text, only captured differently.
     */
    origin: text("origin").$type<ConsentOrigin>(),
  },
  (table) => [
    check(
      "consent_records_origin_check",
      sql`${table.origin} IS NULL OR ${table.origin} = 'paper'`,
    ),
  ],
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
