import { and, eq } from "drizzle-orm";

import type { DrizzleHandle } from "./client.js";
import {
  eventRoleGrants,
  type EventScopedRole,
} from "./schema/event-role-grants.js";
import { events } from "./schema/events.js";
import { users } from "./schema/users.js";

/**
 * 044 EARS-38 (#2384) — the reads over `event_role_grants` the API's
 * authorization step and admin session projection share. They live beside the
 * table rather than in one API module because two API modules (the admin session
 * read and the registration desk routes) consume them, and the future grants
 * screen (#2378) and partner role (#2379) will too.
 */

/** The bound event of a grant, as the authorization step and the session read need it. */
export interface EventGrantBinding {
  role: EventScopedRole;
  eventId: string;
  eventSlug: string;
}

/**
 * The grant a user holds for one event-scoped role, joined to its event's slug —
 * `null` when the user holds no binding row for that role (044 EARS-38: a
 * principal with the role but no binding is refused everywhere except the
 * session endpoints).
 */
export async function findEventGrant(
  db: DrizzleHandle["db"],
  userId: string,
  role: EventScopedRole,
): Promise<EventGrantBinding | null> {
  const rows = await db
    .select({
      role: eventRoleGrants.role,
      eventId: eventRoleGrants.eventId,
      eventSlug: events.slug,
    })
    .from(eventRoleGrants)
    .innerJoin(events, eq(events.id, eventRoleGrants.eventId))
    .where(
      and(eq(eventRoleGrants.userId, userId), eq(eventRoleGrants.role, role)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Every event binding a user holds, keyed by the IdP subject the admin session
 * carries — the projection `GET /v1/admin/auth/session` returns so the admin
 * navigation can draw the bound event's roster (044 EARS-20 / EARS-38).
 */
export async function listEventGrantsBySub(
  db: DrizzleHandle["db"],
  zitadelSub: string,
): Promise<EventGrantBinding[]> {
  return db
    .select({
      role: eventRoleGrants.role,
      eventId: eventRoleGrants.eventId,
      eventSlug: events.slug,
    })
    .from(eventRoleGrants)
    .innerJoin(users, eq(users.id, eventRoleGrants.userId))
    .innerJoin(events, eq(events.id, eventRoleGrants.eventId))
    .where(eq(users.zitadelSub, zitadelSub))
    .orderBy(eventRoleGrants.role, eventRoleGrants.createdAt);
}
