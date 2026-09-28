import { boolean, date, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

import { registrations } from "./registrations.js";

/**
 * `registration_attendance` — 044 EARS-34 (#2381): whether a registered
 * participant was present on ONE congress day (044-design §«Data model»).
 *
 * One row per `(registration, day)`: marking 23 April never touches 24 April,
 * and a day nobody has marked has no row at all (the roster reads a missing row
 * as «not present»).
 *
 * Deliberately NO author and NO timestamp columns: «who marked it, and when» is
 * the 010 ledger's answer. The table carries the `audit_row_change()` trigger
 * (migration 0041), and the desk route writes through the request audit
 * context, so every mark and unmark lands in `audit_ledger` with the acting
 * registrar's `sub` and source `admin-ui`. Copying that fact into columns here
 * would be a second, unaudited history of the same change.
 *
 * The set of allowed days is NOT a CHECK: it is per-deployment configuration
 * (`CONGRESS_SIGNUP_EVENT_DAYS`), validated by the service before the write.
 *
 * `ON DELETE cascade`: an attendance mark has no meaning without the
 * registration it marks, and the ledger keeps the trail of both.
 */
export const registrationAttendance = pgTable(
  "registration_attendance",
  {
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    present: boolean("present").notNull(),
  },
  (t) => [primaryKey({ columns: [t.registrationId, t.day] })],
);

export type RegistrationAttendance = typeof registrationAttendance.$inferSelect;
