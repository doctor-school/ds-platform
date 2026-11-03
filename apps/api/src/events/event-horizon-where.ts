import { and, eq, gte, lt, or, type SQL } from "drizzle-orm";
import { events } from "@ds/db";

/**
 * The start-instant clause of a listing range — the ONE translation of a
 * horizon range ({@link import("./event-horizon.js").EventHorizonReach}) into
 * SQL, shared by the Academy listing and the doctor feed so the two reads of
 * the one horizon codec cannot disagree about which эфиры a range holds.
 *
 * Half-open `[fromInstant, toInstant)` on `starts_at`; a `null` bound is open.
 * A `running` range (it holds today, 004 EARS-9 / #3639) also holds every
 * `live` эфир that started before `fromInstant` — one that went live before
 * Moscow midnight is still on air, and only `ended` / `archived` drop a card
 * from «Будущие». Only the EARLIER ones are added: a `live` row starting
 * inside or past the range is placed by its start like any other, so a range
 * and the reach beyond its moving edge never both hold one эфир.
 */
export function eventStartsInRange(range: {
  fromInstant: Date | null;
  toInstant: Date | null;
  running: boolean;
}): SQL[] {
  const bounds: SQL[] = [];
  if (range.fromInstant !== null) {
    bounds.push(gte(events.startsAt, range.fromInstant));
  }
  if (range.toInstant !== null) {
    bounds.push(lt(events.startsAt, range.toInstant));
  }
  if (!range.running || range.fromInstant === null) return bounds;
  return [
    or(
      and(...bounds),
      and(eq(events.state, "live"), lt(events.startsAt, range.fromInstant)),
    )!,
  ];
}
