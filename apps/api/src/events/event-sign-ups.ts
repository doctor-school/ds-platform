import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import {
  directionAdjacency,
  directionSpecialties,
  directions,
  doctorSpecialties,
  eventDirections,
  registrations,
  specialtiesMinzdrav,
} from "@ds/db";
import { isParticipant } from "../auth/staff-role.js";

/**
 * 019 EARS-2 / wave-2 entry gate §4.2 (owner decision A2) — the colleagues'
 * sign-up count of each event: its ACTIVE registrations by participants (a
 * staff account's sign-up is not a colleague, #2456). The ONE count both
 * storefront cards carry — the doctor feed card and the Academy listing card —
 * read in one grouped query per page, never one per card.
 */
export async function countEventSignUps(
  db: DrizzleHandle["db"],
  eventIds: readonly string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: registrations.eventId, total: count() })
    .from(registrations)
    .where(
      and(
        inArray(registrations.eventId, [...eventIds]),
        eq(registrations.recordStatus, "active"),
        isParticipant(registrations.userId),
      ),
    )
    .groupBy(registrations.eventId);

  return new Map(rows.map((row) => [row.eventId, Number(row.total)]));
}

/**
 * 020 EARS-3 (#1767) — the specialty partition of ONE event's colleague
 * sign-ups: of the registrants {@link countEventSignUps} counts (active,
 * participants only), how many hold a profile specialty (017 EARS-6, the
 * active primary `doctor_specialties` row) that OWNS one of the event's active
 * directions, and how many — not already «same» — reach one through an active
 * adjacency edge from their own directions. The traversal is exactly 017's
 * managed targeting (`TargetingRepository.findOwnDirections` /
 * `findAdjacentDirections`: active links and edges, published non-retired
 * directions, the «Другое» catch-all owning none), so «adjacent» here is the
 * same relation the «моя и смежные» feed scope walks — never a name match.
 * The total stays {@link countEventSignUps}'s; this read adds only the split.
 */
export async function partitionEventSignUps(
  db: DrizzleHandle["db"],
  eventId: string,
): Promise<{ sameSpecialty: number; adjacentSpecialties: number }> {
  const result = await db.execute<{ same: number; adjacent: number }>(sql`
    WITH event_dirs AS (
      SELECT ${eventDirections.directionId} AS direction_id
        FROM ${eventDirections}
       WHERE ${eventDirections.eventId} = ${eventId}
         AND ${eventDirections.status} = 'active'
         AND ${eventDirections.deletedAt} IS NULL
    ),
    registrants AS (
      SELECT DISTINCT ${registrations.userId} AS user_id
        FROM ${registrations}
       WHERE ${registrations.eventId} = ${eventId}
         AND ${registrations.recordStatus} = 'active'
         AND ${isParticipant(registrations.userId)}
    ),
    own AS (
      SELECT DISTINCT ${doctorSpecialties.doctorId} AS user_id,
                      ${directionSpecialties.directionId} AS direction_id
        FROM ${doctorSpecialties}
        JOIN ${specialtiesMinzdrav}
          ON ${specialtiesMinzdrav.id} = ${doctorSpecialties.specialtyId}
         AND ${specialtiesMinzdrav.isOther} = false
        JOIN ${directionSpecialties}
          ON ${directionSpecialties.specialtyMinzdravId} = ${doctorSpecialties.specialtyId}
         AND ${directionSpecialties.status} = 'active'
         AND ${directionSpecialties.deletedAt} IS NULL
        JOIN ${directions}
          ON ${directions.id} = ${directionSpecialties.directionId}
         AND ${directions.status} = 'published'
         AND ${directions.deletedAt} IS NULL
       WHERE ${doctorSpecialties.doctorId} IN (SELECT user_id FROM registrants)
         AND ${doctorSpecialties.role} = 'primary'
         AND ${doctorSpecialties.status} = 'active'
         AND ${doctorSpecialties.deletedAt} IS NULL
    ),
    adjacent AS (
      SELECT DISTINCT own.user_id,
                      ${directionAdjacency.adjacentDirectionId} AS direction_id
        FROM own
        JOIN ${directionAdjacency}
          ON ${directionAdjacency.directionId} = own.direction_id
         AND ${directionAdjacency.status} = 'active'
         AND ${directionAdjacency.deletedAt} IS NULL
        JOIN ${directions}
          ON ${directions.id} = ${directionAdjacency.adjacentDirectionId}
         AND ${directions.status} = 'published'
         AND ${directions.deletedAt} IS NULL
    ),
    same_users AS (
      SELECT DISTINCT user_id FROM own
       WHERE direction_id IN (SELECT direction_id FROM event_dirs)
    ),
    adjacent_users AS (
      SELECT DISTINCT user_id FROM adjacent
       WHERE direction_id IN (SELECT direction_id FROM event_dirs)
         AND user_id NOT IN (SELECT user_id FROM same_users)
    )
    SELECT (SELECT count(*) FROM same_users)::int AS same,
           (SELECT count(*) FROM adjacent_users)::int AS adjacent
  `);
  const row = result.rows[0];
  return {
    sameSpecialty: Number(row?.same ?? 0),
    adjacentSpecialties: Number(row?.adjacent ?? 0),
  };
}
