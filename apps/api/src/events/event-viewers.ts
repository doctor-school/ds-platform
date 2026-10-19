import { sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { presenceBeats } from "@ds/db";
import { isParticipant } from "../auth/staff-role.js";

/**
 * Wave-3 entry gate H2 (row 43) — «Смотрели N коллег»: the number of DISTINCT
 * participants with an accepted room presence beat for the event. The same
 * durable append-only `presence_beats` (006 EARS-4) and the same participant
 * filter as the live room count `PresenceRepository.countLivePresence` — but
 * with NO freshness window: it is the эфир's whole audience, not who is in the
 * room now. The heartbeat is refused for a non-`live` event, so recording
 * playback appends nothing and N is the live audience. An aggregate integer
 * only — never an identity or the roster (006 EARS-8).
 */
export async function countEventViewers(
  db: DrizzleHandle["db"],
  eventId: string,
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(DISTINCT ${presenceBeats.userId})::int AS count
      FROM ${presenceBeats}
     WHERE ${presenceBeats.eventId} = ${eventId}
       AND ${isParticipant(presenceBeats.userId)}
  `);
  return Number(result.rows[0]?.count ?? 0);
}
