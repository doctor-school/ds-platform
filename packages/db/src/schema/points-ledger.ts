import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, projects } from "./taxonomy.js";
import { users } from "./users.js";

// 025 attention-points engine — the ledger core (025-design §2, §3; ADR-0016 §6;
// ADR-0003 §2.7 / §3). One append-only ledger family: accounts per subject,
// immutable double-entry postings, a balance is a fold `Σ credits − Σ debits`
// per (account, denomination). No balance column exists anywhere.
//
// drizzle does NOT model `PARTITION BY`, the per-row immutability trigger, the
// cross-table posting/account consistency trigger or the pg_partman
// registration — that DDL is hand-written in migration
// `0058_points_ledger.sql`, exactly as `audit_ledger` does in 0003/0004. The
// table configs below keep the drizzle snapshot honest so `lint:db-drift`
// reports no drift.

/** Subject kinds a ledger account belongs to (025-design §2). */
export const POINTS_SUBJECT_KINDS = [
  "person",
  "project_fund",
  "organisation",
  "system",
] as const;
/** Ledger units: attention points (Pul/Bre/Con denominations) or money. */
export const POINTS_UNITS = ["attention_points", "money"] as const;
/** System accounts, one per unit (025-design §2 «Accounts»). */
export const POINTS_SYSTEM_CODES = [
  "issuance",
  "reserve",
  "sink",
  "advance",
] as const;
/** Denominations of the `attention_points` unit (ADR-0016 §6). */
export const POINTS_DENOMINATIONS = ["pul", "bre", "con"] as const;

/**
 * EARS-1 — one ledger account per (subject, unit). A person keeps exactly one
 * `attention_points` account; a system account is keyed by `system_code`
 * instead of a subject id. `closed_at` freezes the account (EARS-31).
 */
export const pointsAccounts = pgTable(
  "points_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    /** The subject (person = `users.id`); null for a system account. Polymorphic, so no FK. */
    subjectId: uuid("subject_id"),
    /** Set only for `subject_kind = system`. */
    systemCode: text("system_code"),
    unit: text("unit").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** EARS-31 — set by the personal-data lifecycle; the account then refuses every posting. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    unique("points_accounts_subject_unit_unique").on(
      table.subjectKind,
      table.subjectId,
      table.unit,
    ),
    unique("points_accounts_system_code_unit_unique").on(
      table.systemCode,
      table.unit,
    ),
    check(
      "points_accounts_subject_kind_check",
      sql`${table.subjectKind} IN ('person', 'project_fund', 'organisation', 'system')`,
    ),
    check(
      "points_accounts_unit_check",
      sql`${table.unit} IN ('attention_points', 'money')`,
    ),
    check(
      "points_accounts_system_code_check",
      sql`${table.systemCode} IS NULL OR ${table.systemCode} IN ('issuance', 'reserve', 'sink', 'advance')`,
    ),
    // A system account has a code and no subject; every other account has a
    // subject and no code — so exactly one of the two unique keys applies.
    check(
      "points_accounts_subject_shape_check",
      sql`(${table.subjectKind} = 'system' AND ${table.systemCode} IS NOT NULL AND ${table.subjectId} IS NULL)
        OR (${table.subjectKind} <> 'system' AND ${table.systemCode} IS NULL AND ${table.subjectId} IS NOT NULL)`,
    ),
  ],
);

/**
 * EARS-4 — global dedupe over monthly partitions (025-design §2 «Event id, leg
 * and dedupe key»). One row per domain fact, inserted in the fact's
 * transaction BEFORE its postings; the PK on `event_id` and the UNIQUE (NULLS
 * DISTINCT) `dedupe_key` are the authority, not a read-before-write.
 */
export const pointsPostingKeys = pgTable(
  "points_posting_keys",
  {
    /** The one domain fact's id (producer event id or a derived engine fact id). */
    eventId: text("event_id").primaryKey(),
    /** `<personId>:<contentRef>:<action>` for an accrual fact; null for a spend fact. */
    dedupeKey: text("dedupe_key"),
    /** First day (UTC) of the month the fact occurred in — the partition its postings live in. */
    occurredMonth: date("occurred_month").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("points_posting_keys_dedupe_key_unique").on(table.dedupeKey),
  ],
);

/**
 * EARS-27 — the rule version every posting cites. Table only in this slice:
 * publishing (EARS-25) and the default rule book are #3808.
 */
export const pointsRuleVersions = pgTable(
  "points_rule_versions",
  {
    ruleId: text("rule_id").notNull(),
    version: integer("version").notNull(),
    /** Zod-validated rule parameters (amounts, caps, windows). */
    parameters: jsonb("parameters").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    /** The publishing admin; null for a version the platform itself seeds. */
    publishedBy: uuid("published_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "points_rule_versions_pkey",
      columns: [table.ruleId, table.version],
    }),
    check("points_rule_versions_version_check", sql`${table.version} >= 1`),
  ],
);

/**
 * EARS-27 / EARS-22 — immutable double-entry postings, RANGE-partitioned by
 * month on `occurred_at` (migration 0058). Postgres requires the partition key
 * in every unique/primary-key constraint, so the PK is `(id, occurred_at)` and
 * the per-fact uniqueness is `(event_id, leg, occurred_at)` — effectively
 * `(event_id, leg)` because every posting of one fact shares its
 * `occurred_at`; GLOBAL dedupe is `points_posting_keys`. A reversal references
 * the reversed posting by its full key `(reverses_posting_id,
 * reverses_occurred_at)`.
 */
export const pointsPostings = pgTable(
  "points_postings",
  {
    id: uuid("id").defaultRandom().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => pointsPostingKeys.eventId),
    /** The posting within its fact: entry kind + denomination (`accrual:pul`, `reserve:balance`, …). */
    leg: text("leg").notNull(),
    debitAccountId: uuid("debit_account_id")
      .notNull()
      .references(() => pointsAccounts.id),
    creditAccountId: uuid("credit_account_id")
      .notNull()
      .references(() => pointsAccounts.id),
    /** Required for `attention_points` accounts, absent for `money` (enforced by trigger, 0058). */
    denomination: text("denomination"),
    amount: integer("amount").notNull(),
    action: text("action"),
    projectId: uuid("project_id").references(() => projects.id),
    outputType: text("output_type"),
    outputId: uuid("output_id"),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    attributedOrganisationId: uuid("attributed_organisation_id").references(
      () => organisations.id,
    ),
    attributedMemberId: uuid("attributed_member_id").references(() => users.id),
    reversesPostingId: uuid("reverses_posting_id"),
    reversesOccurredAt: timestamp("reverses_occurred_at", {
      withTimezone: true,
    }),
    /** Partition key — the table is RANGE-partitioned on this column (monthly). */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "points_postings_pkey",
      columns: [table.id, table.occurredAt],
    }),
    unique("points_postings_event_leg_unique").on(
      table.eventId,
      table.leg,
      table.occurredAt,
    ),
    foreignKey({
      name: "points_postings_rule_version_fk",
      columns: [table.ruleId, table.ruleVersion],
      foreignColumns: [pointsRuleVersions.ruleId, pointsRuleVersions.version],
    }),
    foreignKey({
      name: "points_postings_reverses_fk",
      columns: [table.reversesPostingId, table.reversesOccurredAt],
      foreignColumns: [table.id, table.occurredAt],
    }),
    check("points_postings_amount_check", sql`${table.amount} > 0`),
    check(
      "points_postings_denomination_check",
      sql`${table.denomination} IS NULL OR ${table.denomination} IN ('pul', 'bre', 'con')`,
    ),
    check(
      "points_postings_distinct_accounts_check",
      sql`${table.debitAccountId} <> ${table.creditAccountId}`,
    ),
    check(
      "points_postings_reverses_pair_check",
      sql`(${table.reversesPostingId} IS NULL) = (${table.reversesOccurredAt} IS NULL)`,
    ),
    // The balance fold reads postings per (account, denomination).
    index("points_postings_debit_idx").on(
      table.debitAccountId,
      table.denomination,
    ),
    index("points_postings_credit_idx").on(
      table.creditAccountId,
      table.denomination,
    ),
  ],
);

export type PointsAccountRow = typeof pointsAccounts.$inferSelect;
export type PointsPostingKeyRow = typeof pointsPostingKeys.$inferSelect;
export type PointsRuleVersionRow = typeof pointsRuleVersions.$inferSelect;
export type PointsPostingRow = typeof pointsPostings.$inferSelect;
export type NewPointsPostingRow = typeof pointsPostings.$inferInsert;
