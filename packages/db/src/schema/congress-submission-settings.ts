import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { events } from "./events.js";

/**
 * The kinds of congress material a kind-settings row may hold (046-design
 * §«Data model»). Mirrored by `CONGRESS_SUBMISSION_KINDS` in `@ds/schemas`; the
 * CHECK below keeps a free-text kind — one no intake read ever matches — out of
 * the table.
 */
export const CONGRESS_SETTINGS_KINDS = ["oral", "poster", "abstract"] as const;
export type CongressSettingsKind = (typeof CONGRESS_SETTINGS_KINDS)[number];

/**
 * `congress_submission_settings` — 046 EARS-1 (#2432): the event-level congress
 * intake settings. A row's presence IS the event's congress section: an event
 * without one has no section and accepts no submission.
 *
 * - `registration_url` — the external registration address the section links to
 *   while the account has no registration (EARS-5); nullable until set.
 * - `first_author_counts` — the first-author counting rule (EARS-24), off by default.
 *
 * Settings live in platform data, not environment (046-design «Settings in
 * platform data»): a change takes effect on the next request without a
 * release. Storefront ownership (ADR-0016 §8): `admin-only`.
 *
 * Audited by the 010 `audit_row_change()` trigger, so «who moved the deadline»
 * is answered by `audit_ledger`. `ON DELETE restrict` into `events`, like every
 * retained child (#1278).
 */
export const congressSubmissionSettings = pgTable(
  "congress_submission_settings",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "restrict" }),
    registrationUrl: text("registration_url"),
    firstAuthorCounts: boolean("first_author_counts").notNull().default(false),
  },
);

export type CongressSubmissionSettings =
  typeof congressSubmissionSettings.$inferSelect;

/**
 * `congress_submission_kind_settings` — 046 EARS-1 (#2432): per event and per
 * kind, the intake window, the submit limit and the age limit.
 *
 * - `opens_at` — 00:00 Moscow of the opening day; empty while not announced.
 * - `closes_at` — 00:00 Moscow of the day after the last day of acceptance.
 * - `submit_limit` — per participant; empty = unlimited.
 * - `max_age_years` — whole years; empty = none.
 *
 * The CHECKs restate EARS-2's server refusals at the storage layer, so no write
 * path can hold an opening without a closing, an inverted window, a zero limit
 * or an age limit outside 18…99. Audited by the 010 trigger like its parent.
 */
export const congressSubmissionKindSettings = pgTable(
  "congress_submission_kind_settings",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => congressSubmissionSettings.eventId, {
        onDelete: "restrict",
      }),
    kind: text("kind").$type<CongressSettingsKind>().notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    submitLimit: integer("submit_limit"),
    maxAgeYears: integer("max_age_years"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.kind] }),
    check(
      "congress_submission_kind_settings_kind_known",
      sql`${t.kind} IN ('oral', 'poster', 'abstract')`,
    ),
    check(
      "congress_submission_kind_settings_opening_needs_closing",
      sql`${t.opensAt} IS NULL OR ${t.closesAt} IS NOT NULL`,
    ),
    check(
      "congress_submission_kind_settings_closing_after_opening",
      sql`${t.opensAt} IS NULL OR ${t.closesAt} > ${t.opensAt}`,
    ),
    check(
      "congress_submission_kind_settings_limit_positive",
      sql`${t.submitLimit} IS NULL OR ${t.submitLimit} > 0`,
    ),
    check(
      "congress_submission_kind_settings_age_range",
      sql`${t.maxAgeYears} IS NULL OR ${t.maxAgeYears} BETWEEN 18 AND 99`,
    ),
  ],
);

export type CongressSubmissionKindSettings =
  typeof congressSubmissionKindSettings.$inferSelect;
