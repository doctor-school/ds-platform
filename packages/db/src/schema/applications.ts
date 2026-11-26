import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { consentRecords } from "./consent-records.js";
import { users } from "./users.js";

/**
 * 033 — the shared application queue (033-design «Data model»).
 *
 * One row per submitted request of any kind (`author`, `partnership`; 034's
 * investor kind extends `applications_kind_check`). The row is
 * the record of truth AND the intake's idempotent result: the key lives here,
 * unique per kind, so a replay is one lookup inside the intake transaction.
 *
 * Retention (ADR-0009 design §3 rows `applications` / `application_notes`):
 * an open application with no status change for a year is closed `expired`
 * (EARS-23) and every application is erased to the tombstone a year after
 * `closed_at` (EARS-20) by the daily purge in
 * `apps/api/src/applications/applications.purge.ts`; account erasure applies
 * the tombstone at once (EARS-24). No row is deleted (ADR-0009 §2.3): the
 * tombstone keeps kind, status, outcome and times.
 *
 * PD columns `payload`, `contact`, `subject_line` (and `application_notes.body`)
 * are masked in the 010 ledger (`AUDIT_PD_COLUMNS`, EARS-25).
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("new"),
    outcome: text("outcome"),
    applicantUserId: uuid("applicant_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    /** Per-kind schema, or the `{"erased": true}` tombstone (EARS-20). */
    payload: jsonb("payload").notNull(),
    /** No-account kinds only: the contact the requester gave. */
    contact: jsonb("contact"),
    subjectLine: text("subject_line"),
    consentRecordId: uuid("consent_record_id").references(
      () => consentRecords.id,
      { onDelete: "restrict" },
    ),
    consentPurpose: text("consent_purpose").notNull(),
    consentVersionTag: text("consent_version_tag").notNull(),
    idempotencyKey: uuid("idempotency_key"),
    /** The interim partnership import's own record id (EARS-19). */
    legacyRecordId: uuid("legacy_record_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    teamNotice: text("team_notice").notNull().default("pending"),
    receiptNotice: text("receipt_notice").notNull().default("pending"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** The acting administrator; null for the purge's expiry (EARS-23). */
    statusChangedBy: uuid("status_changed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    pdErasedAt: timestamp("pd_erased_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    check("applications_kind_check", sql`${t.kind} IN ('author', 'partnership')`),
    check(
      "applications_status_check",
      sql`${t.status} IN ('new', 'in_review', 'closed')`,
    ),
    check(
      "applications_outcome_check",
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('accepted', 'declined', 'expired')`,
    ),
    // status = closed ⇔ outcome not null ⇔ closed_at not null.
    check(
      "applications_closed_check",
      sql`(${t.status} = 'closed') = (${t.outcome} IS NOT NULL) AND (${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`,
    ),
    // The author kind carries its account and its consent until erasure.
    check(
      "applications_author_check",
      sql`${t.kind} <> 'author' OR ${t.pdErasedAt} IS NOT NULL OR (${t.applicantUserId} IS NOT NULL AND ${t.consentRecordId} IS NOT NULL)`,
    ),
    // The tombstone form only with pd_erased_at, and an erased row holds no PD.
    check(
      "applications_tombstone_check",
      sql`(${t.payload} = '{"erased": true}'::jsonb) = (${t.pdErasedAt} IS NOT NULL) AND (${t.pdErasedAt} IS NULL OR (${t.contact} IS NULL AND ${t.subjectLine} IS NULL AND ${t.applicantUserId} IS NULL))`,
    ),
    check(
      "applications_team_notice_check",
      sql`${t.teamNotice} IN ('pending', 'sent', 'failed', 'skipped', 'imported')`,
    ),
    check(
      "applications_receipt_notice_check",
      sql`${t.receiptNotice} IN ('pending', 'sent', 'failed', 'not_applicable')`,
    ),
    index("applications_submitted_idx").on(t.submittedAt.desc(), t.id),
    index("applications_kind_status_submitted_idx").on(
      t.kind,
      t.status,
      t.submittedAt.desc(),
    ),
    index("applications_open_applicant_idx")
      .on(t.applicantUserId)
      .where(sql`${t.status} <> 'closed'`),
    index("applications_open_clock_idx")
      .on(sql`coalesce(${t.statusChangedAt}, ${t.submittedAt})`)
      .where(sql`${t.status} <> 'closed'`),
    index("applications_erase_due_idx")
      .on(t.closedAt)
      .where(sql`${t.pdErasedAt} IS NULL`),
    index("applications_applicant_idx").on(t.applicantUserId),
    uniqueIndex("applications_kind_idempotency_key_uniq").on(
      t.kind,
      t.idempotencyKey,
    ),
    uniqueIndex("applications_legacy_record_id_uniq").on(t.legacyRecordId),
  ],
);

/**
 * 033 EARS-16 — append-only internal notes of the team (the writer is the
 * admin-queue slice, #4030). On the application's erasure every body becomes
 * the sentinel `[стёрто]` (EARS-20); no note row is ever deleted.
 */
export const applicationNotes = pgTable(
  "application_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    authorAdminId: uuid("author_admin_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "application_notes_body_check",
      sql`char_length(${t.body}) BETWEEN 1 AND 2000`,
    ),
    index("application_notes_application_idx").on(t.applicationId, t.createdAt),
  ],
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationNote = typeof applicationNotes.$inferSelect;
export type NewApplicationNote = typeof applicationNotes.$inferInsert;
