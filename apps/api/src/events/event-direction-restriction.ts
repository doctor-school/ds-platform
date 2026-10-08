import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { eventDirections } from "@ds/db";

/**
 * 019 EARS-3 / EARS-6 — the ids of the events carrying an ACTIVE managed
 * `event → direction` row, optionally restricted to the given directions. The
 * ONE targeting subquery of the doctor storefront: its feed, its month grid
 * and the shared live resolution (`EventsLiveService`) all restrict through it,
 * so «targeted» cannot mean two things on one host. Never a name comparison.
 */
export function eventsOnActiveDirections(
  db: DrizzleHandle["db"],
  directionIds: string[] | null,
) {
  const restriction = [
    eq(eventDirections.status, "active"),
    isNull(eventDirections.deletedAt),
  ];
  if (directionIds !== null) {
    restriction.push(inArray(eventDirections.directionId, directionIds));
  }
  return db
    .select({ id: eventDirections.eventId })
    .from(eventDirections)
    .where(and(...restriction));
}
