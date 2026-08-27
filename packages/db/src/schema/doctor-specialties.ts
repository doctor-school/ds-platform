import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { recordStatus } from "./lifecycle.js";
import { specialtiesMinzdrav } from "./specialties.js";
import { users } from "./users.js";

// 017 EARS-6 / LD-1 (#1482) — the doctor ↔ specialty LINK ROW.
//
// LD-1 is the reason this is a table and not a `users.primary_specialty_id`
// column: 017 ships exactly ONE primary specialty per doctor, but the cap is a
// property of a partial unique index here rather than of the shape of the
// profile row. Raising it later (a second specialty, a `role` other than
// `primary`) is dropping one index and widening one enum — additive — instead of
// re-modelling a column into a table and rewriting every read that resolved it.
//
// No second-specialty control, field or flag ships with it: `role` has exactly
// one member today, and the partial unique index means the database itself
// refuses a second active primary row. The shape is a storage choice, not a
// hidden feature (LD-1).

/**
 * The role a link row expresses. Exactly one member in 017 — `primary`, the
 * single specialty every targeting read resolves. It is an ENUM rather than a
 * free-text column so that widening it later is a reviewed migration and not an
 * arbitrary string a caller can invent.
 */
export const doctorSpecialtyRole = pgEnum("doctor_specialty_role", ["primary"]);

/**
 * `doctor_specialties` — a doctor's chosen specialty, as a link row.
 *
 * ## Lifecycle (#1278, ADR-0003 design §3.6)
 *
 * Soft-removable: `record_status` + `deleted_at`, pinned by the
 * `retired ⇔ deleted_at IS NOT NULL` CHECK. A re-choice RETIRES the standing row
 * and inserts the new one in one transaction rather than updating the specialty
 * in place — the history of what a doctor was targeted on is evidence the
 * targeting reads (EARS-8) and the audit trail are both entitled to, and an
 * in-place update would erase it. `version` carries the same
 * optimistic-concurrency column its sibling link tables do.
 *
 * ## Referential integrity
 *
 * Both foreign keys are `ON DELETE restrict`. `users` rows are never hard-deleted
 * (see `users.ts`), and `specialties_minzdrav` is a re-seeded reference book
 * whose `id` survives a re-seed by design — so a cascade would only ever fire on
 * an accident, and restricting turns that accident into a failed statement
 * instead of a silently vanished choice.
 *
 * ## The one-primary cap
 *
 * `doctor_specialties_primary_active_uniq` is a PARTIAL unique index on
 * `doctor_id` limited to active primary rows. That is what makes «one primary
 * specialty» (LD-1) an invariant of the store rather than a promise of the
 * service: retired rows accumulate freely, and a concurrent double-choose loses
 * one insert to the index rather than leaving a doctor with two targetings.
 */
export const doctorSpecialties = pgTable(
  "doctor_specialties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    specialtyId: uuid("specialty_id")
      .notNull()
      .references(() => specialtiesMinzdrav.id, { onDelete: "restrict" }),
    role: doctorSpecialtyRole("role").notNull().default("primary"),
    status: recordStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // LD-1's cap, enforced by the store (see the doc comment above).
    uniqueIndex("doctor_specialties_primary_active_uniq")
      .on(t.doctorId)
      .where(sql`${t.status} = 'active' AND ${t.role} = 'primary'`),
    // Every read of this table is «this doctor's rows» — the profile read on
    // first authenticated navigation, and the targeting resolution behind it.
    index("doctor_specialties_doctor_idx").on(t.doctorId),
    check(
      "doctor_specialties_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("doctor_specialties_version_positive", sql`${t.version} >= 1`),
  ],
);

export type DoctorSpecialty = typeof doctorSpecialties.$inferSelect;
export type NewDoctorSpecialty = typeof doctorSpecialties.$inferInsert;
