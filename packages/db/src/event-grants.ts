import { and, eq, or } from "drizzle-orm";

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
 * 046 EARS-26 (#2437) — the grant a user holds for one event-scoped role on ONE
 * event, matched by the event's id or slug — `null` when no such binding exists.
 * The programme committee may be bound to several events, so the authorization
 * step asks about the path's event rather than about «the» grant.
 */
export async function findEventGrantForEvent(
  db: DrizzleHandle["db"],
  userId: string,
  role: EventScopedRole,
  idOrSlug: string,
): Promise<EventGrantBinding | null> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrSlug,
    );
  const rows = await db
    .select({
      role: eventRoleGrants.role,
      eventId: eventRoleGrants.eventId,
      eventSlug: events.slug,
    })
    .from(eventRoleGrants)
    .innerJoin(events, eq(events.id, eventRoleGrants.eventId))
    .where(
      and(
        eq(eventRoleGrants.userId, userId),
        eq(eventRoleGrants.role, role),
        isUuid
          ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
          : eq(events.slug, idOrSlug),
      ),
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

/**
 * 047 EARS-3 — every binding a user holds for one event-scoped role, keyed by
 * the `users` row id. The grant reads it for the «registrar already bound to
 * another event» refusal and for the completeness check (047-design
 * §Completeness and retry).
 */
export async function listEventGrantsForUserRole(
  db: DrizzleHandle["db"],
  userId: string,
  role: EventScopedRole,
): Promise<EventGrantBinding[]> {
  return db
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
    .orderBy(eventRoleGrants.createdAt);
}

/** One event binding as the «Доступы» list expands it (047 EARS-2). */
export interface StaffEventBinding {
  zitadelSub: string;
  role: EventScopedRole;
  eventId: string;
  eventTitle: string;
}

/**
 * 047 EARS-2 — every event binding of every user, joined to the holder's IdP
 * subject and the event's title, in one read. The list joins it to the IdP's
 * grant search; a few dozen staff rows, so no paging.
 */
export async function listStaffEventBindings(
  db: DrizzleHandle["db"],
): Promise<StaffEventBinding[]> {
  return db
    .select({
      zitadelSub: users.zitadelSub,
      role: eventRoleGrants.role,
      eventId: eventRoleGrants.eventId,
      eventTitle: events.title,
    })
    .from(eventRoleGrants)
    .innerJoin(users, eq(users.id, eventRoleGrants.userId))
    .innerJoin(events, eq(events.id, eventRoleGrants.eventId))
    .orderBy(eventRoleGrants.role, eventRoleGrants.createdAt);
}

/**
 * 047 EARS-4/5 — write the binding of an event-scoped role to one event, unless
 * it already exists. Idempotent by the `(user_id, role, event_id)` unique index,
 * so the repeat of a part-failed grant skips it (047-design §Completeness and
 * retry). Takes the caller's transaction: the binding commits with the mirror
 * row and the `auth.role.granted` audit row, under the request's 010 actor.
 * Resolves `true` when a row was written.
 */
export async function insertEventGrant(
  db: Pick<DrizzleHandle["db"], "insert">,
  grant: { userId: string; role: EventScopedRole; eventId: string },
): Promise<boolean> {
  const written = await db
    .insert(eventRoleGrants)
    .values(grant)
    .onConflictDoNothing({
      target: [
        eventRoleGrants.userId,
        eventRoleGrants.role,
        eventRoleGrants.eventId,
      ],
    })
    .returning({ id: eventRoleGrants.id });
  return written.length > 0;
}
