import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { events } from "./events.js";
import { users } from "./users.js";

/**
 * The event-scoped roles a grant row may bind. One member today — the 044
 * congress desk registrar (EARS-38). The future partner role (#2379) widens this
 * list and the CHECK below in one reviewed migration; a free-text role that no
 * authorization read ever matches would otherwise be a grant that silently
 * grants nothing.
 */
export const EVENT_SCOPED_ROLES = ["event-registrar"] as const;
export type EventScopedRole = (typeof EVENT_SCOPED_ROLES)[number];

/**
 * `event_role_grants` — 044 EARS-38 (#2384): the binding of an event-scoped role
 * to one event (044-design §«Data model», ER `event_role_grants`).
 *
 * ADR-0001 §1's hybrid RBAC as written: the coarse role stays in the Zitadel
 * project-roles claim (`users.role` only mirrors it), and the RESOURCE binding —
 * which event the role is for — lives here, in platform data, with a real
 * foreign key to `events` that IdP metadata could not hold. The authorization
 * step reads it in the request, with no IdP round trip and no custom token claim.
 *
 * One `event-registrar` grant per user (the partial unique index): a desk
 * registrar works exactly one congress. The partner role (#2379) writes the same
 * table and decides its own cardinality when it lands.
 *
 * Audited by the 010 `audit_row_change()` trigger like every domain table, so
 * «who bound whom to which event, and when» is answered by `audit_ledger`. Until
 * the grants screen (#2378) ships the tech lead inserts a row by hand, which the
 * ledger honestly records as `db-direct` (runbook: apps/api/src/registration/README.md).
 *
 * Both FKs are `ON DELETE restrict`, like every retained child of `users` and
 * `events` (#1278).
 */
export const eventRoleGrants = pgTable(
  "event_role_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").$type<EventScopedRole>().notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("event_role_grants_registrar_user_uniq")
      .on(t.userId, t.role)
      .where(sql`${t.role} = 'event-registrar'`),
    index("event_role_grants_event_idx").on(t.eventId),
    check(
      "event_role_grants_role_known",
      sql`${t.role} IN ('event-registrar')`,
    ),
  ],
);

export type EventRoleGrant = typeof eventRoleGrants.$inferSelect;
