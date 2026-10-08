import { and, count, eq, inArray } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { registrations } from "@ds/db";
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
