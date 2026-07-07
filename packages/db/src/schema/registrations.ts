import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
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
// EARS-1 lands the record + the one-action write + the immediate
// `EventRegistrationState` flip. The `UNIQUE (user_id, event_id)` constraint
// that turns `RegisterForEvent` into an idempotent upsert (the one-registration
// invariant) and the terminal `audit_ledger` row are the sibling EARS-3 / EARS-8
// handlers, layered on top of this record — an additive migration + a swap of
// the insert to `ON CONFLICT DO NOTHING`.
export const registrations = pgTable("registrations", {
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
});

export type Registration = typeof registrations.$inferSelect;
export type NewRegistration = typeof registrations.$inferInsert;
