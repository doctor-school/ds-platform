import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { events } from "./events.js";
import { recordStatus } from "./lifecycle.js";
import { users } from "./users.js";

// 005 — the durable webinar-registration record (design §2; ADR-0003 Data
// Layer). The thin `(doctor, event, registeredAt)` fact: an authenticated
// `doctor_guest` registered for one event at one canonical UTC instant. It is
// the basis for room admission (006) and the sponsor roster (EARS-8). There is
// **no** cancelled state in wave 1 — every row is current (owner decision);
// adding cancellation later is an additive migration, not a shape 005
// pre-builds. The record carries no denormalized PII — the roster joins to the
// `users` mirror (003) at read time.
//
// #1278 — a registration is a RETAINED row (ADR-0003 design §3.6): both FKs are
// `RESTRICT`, so removing a doctor or an event can never silently erase the
// evidence that the doctor signed up, and the `record_status`/`deleted_at` pair
// below is where a future cancellation lands. The `UNIQUE (user_id, event_id)`
// constraint stays TOTAL rather than partial on purpose: one registration RECORD
// per (doctor, event) for all time, so a cancellation retires that row and a
// later re-registration is the explicit restore of §3.6 rule 2 (`record_status`
// back to `active`, `deleted_at` cleared) — never a second row. That also keeps
// the repository's `ON CONFLICT (user_id, event_id)` upsert keyed on a
// predicate-free constraint.
//
// EARS-1 landed the record + the one-action write + the immediate
// `EventRegistrationState` flip. EARS-3 layers the one-registration invariant on
// top: the `UNIQUE (user_id, event_id)` constraint below is the structural guard
// behind it (design §2), turning `RegisterForEvent` into an idempotent
// `INSERT … ON CONFLICT (user_id, event_id) DO NOTHING` upsert — a repeat via any
// path returns the existing row and emits no second `DoctorRegisteredForEvent` /
// terminal `audit_ledger` row. The invariant is enforced in the database, not by
// client discipline (ADR-0003 §5; Constraints).
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** FK users.id (003 UserMirror) — the registering doctor_guest. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** FK events.id (004/007 read model) — the event registered for. */
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    /** Canonical UTC instant the registration was recorded. */
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * #1278 retained-row lifecycle (§3.6). `active` is a live registration;
     * `retired` + `deleted_at` is the shape a cancellation would write. No
     * writer sets `retired` today — wave 1 has no cancel command (owner
     * decision) — so every row is `active`; the columns exist so cancellation is
     * an ordinary transition when it lands, not a reshape.
     */
    recordStatus: recordStatus("record_status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // The one-registration invariant (EARS-3, ADR-0003 §5): at most one
    // registration per (doctor, event). The `ON CONFLICT (user_id, event_id) DO
    // NOTHING` upsert in the repository keys on exactly this constraint.
    unique("registrations_user_id_event_id_unique").on(
      table.userId,
      table.eventId,
    ),
    check(
      "registrations_retired_iff_deleted",
      sql`(${table.recordStatus} = 'retired') = (${table.deletedAt} IS NOT NULL)`,
    ),
    // §3.6 rule 3: the roster and the `EventRegistrationState` flip both read
    // only live registrations, so the active-row path gets its own partial index.
    index("registrations_active_event_idx")
      .on(table.eventId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type Registration = typeof registrations.$inferSelect;
export type NewRegistration = typeof registrations.$inferInsert;
