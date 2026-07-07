import { pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { events } from "./events.js";
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
      .references(() => users.id, { onDelete: "cascade" }),
    /** FK events.id (004/007 read model) — the event registered for. */
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Canonical UTC instant the registration was recorded. */
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The one-registration invariant (EARS-3, ADR-0003 §5): at most one
    // registration per (doctor, event). The `ON CONFLICT (user_id, event_id) DO
    // NOTHING` upsert in the repository keys on exactly this constraint.
    unique("registrations_user_id_event_id_unique").on(
      table.userId,
      table.eventId,
    ),
  ],
);

export type Registration = typeof registrations.$inferSelect;
export type NewRegistration = typeof registrations.$inferInsert;
