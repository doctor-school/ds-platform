import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { CONGRESS_SETTINGS_KINDS } from "./congress-submission-settings.js";
import { consentRecords } from "./consent-records.js";
import { events } from "./events.js";
import { registrations } from "./registrations.js";
import { users } from "./users.js";

/**
 * The statuses of a congress submission (046-design «Status machine»).
 * Mirrored by `CONGRESS_SUBMISSION_STATUSES` in `@ds/schemas`; the CHECK below
 * keeps any other value out of the table.
 */
export const CONGRESS_SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "needs_revision",
  "withdrawn",
] as const;
export type CongressSubmissionStatusValue =
  (typeof CONGRESS_SUBMISSION_STATUSES)[number];

/**
 * Structural shape of one stored author (046-design «Data model»). MIRRORS the
 * author schemas in `@ds/schemas`, which own the rule; duplicated for the same
 * dependency-order reason as `RegistrationAnswers`.
 */
export interface CongressSubmissionAuthorValue {
  surname?: string | undefined;
  firstName?: string | undefined;
  patronymic?: string | undefined;
  workplace?: string | undefined;
  presenting?: boolean | undefined;
}

/**
 * `congress_submissions` — 046 EARS-4…EARS-17 (#2433): a doctor's congress
 * submission of one kind for one event, owned by the account and held by its
 * registration (no submission without a registration — EARS-5).
 *
 * - `kind` ∈ `oral | poster | abstract`; `status` per the status machine.
 * - `authors` — the ordered author array; `body` — the per-kind text object
 *   validated by the kind's form in `@ds/schemas`; drafts hold them incomplete.
 * - `derived_from_id`, `publication_consent_id`, `statements` — the abstracts
 *   slice's link, РИНЦ consent and statements (EARS-23, EARS-25).
 * - `revision_due_at` — the submission's own revision deadline (EARS-34),
 *   written by the committee's status route; nullable.
 * - `last_letter_*` — the outcome of the last letter (EARS-14, EARS-29).
 * - `reminded_for_closes_at` — the deadline reminder's claim (EARS-33).
 *
 * FKs are `ON DELETE restrict` like every retained child (#1278). Storefront
 * ownership (ADR-0016 §8): `doctor`. Audited by the 010 `audit_row_change()`
 * trigger — that ledger is the status history (EARS-28); `authors` is a
 * PD-masked column (`AUDIT_PD_COLUMNS`).
 */
export const congressSubmissions = pgTable(
  "congress_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind")
      .$type<(typeof CONGRESS_SETTINGS_KINDS)[number]>()
      .notNull(),
    status: text("status")
      .$type<CongressSubmissionStatusValue>()
      .notNull()
      .default("draft"),
    title: text("title").notNull().default(""),
    authors: jsonb("authors")
      .$type<CongressSubmissionAuthorValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    body: jsonb("body")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    derivedFromId: uuid("derived_from_id").references(
      (): AnyPgColumn => congressSubmissions.id,
      { onDelete: "restrict" },
    ),
    publicationConsentId: uuid("publication_consent_id").references(
      () => consentRecords.id,
      { onDelete: "restrict" },
    ),
    statements: jsonb("statements").$type<Record<string, string>>(),
    committeeComment: text("committee_comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revisionDueAt: timestamp("revision_due_at", { withTimezone: true }),
    lastLetterKind: text("last_letter_kind"),
    lastLetterStatus: text("last_letter_status"),
    lastLetterAt: timestamp("last_letter_at", { withTimezone: true }),
    remindedForClosesAt: timestamp("reminded_for_closes_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "congress_submissions_kind_known",
      sql`${t.kind} IN ('oral', 'poster', 'abstract')`,
    ),
    check(
      "congress_submissions_status_known",
      sql`${t.status} IN ('draft', 'submitted', 'in_review', 'accepted', 'rejected', 'needs_revision', 'withdrawn')`,
    ),
    check(
      "congress_submissions_last_letter_status_known",
      sql`${t.lastLetterStatus} IS NULL OR ${t.lastLetterStatus} IN ('sent', 'failed')`,
    ),
    // The author's section and the limit count read by (user, event, kind).
    index("congress_submissions_user_event_kind_idx").on(
      t.userId,
      t.eventId,
      t.kind,
    ),
    // The committee registry reads by event.
    index("congress_submissions_event_status_idx").on(t.eventId, t.status),
  ],
);

export type CongressSubmissionRow = typeof congressSubmissions.$inferSelect;
