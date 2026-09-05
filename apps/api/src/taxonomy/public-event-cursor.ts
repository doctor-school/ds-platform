import { sql, type SQL } from "drizzle-orm";
import { type Event, events } from "@ds/db";

// 012-design §5.2 — the ONE keyset-cursor rule of every public traversal that
// orders events, shared by `/public/projects/:key/events` and
// `/public/directions/:key/events` (012 EARS-12, #1294).
//
// It lives in its own module because the two directions had grown the identical
// cursor arithmetic side by side, and the arithmetic has one non-obvious
// requirement: the instant in the cursor must round-trip LOSSLESSLY.
//
// `events.starts_at` is `timestamptz`, which Postgres stores to the microsecond,
// while node-postgres hands the row to us as a JavaScript `Date`, which holds
// only milliseconds. Encoding the cursor from that `Date` therefore truncates —
// and a truncated cutoff is strictly LESS than the instant it came from, so the
// row that produced the cursor satisfies `starts_at > cutoff` again and is
// served again, forever: an unauthenticated, non-terminating page loop on rows
// whose `starts_at` was written by anything with sub-millisecond precision
// (a `now()` default, an import, a seed script).
//
// So the cursor carries the instant as Postgres itself renders it, to the
// microsecond, and the comparison casts that text straight back to
// `timestamptz`. The order tuple and its index usage are unchanged: this is the
// same `(starts_at, id)` keyset, only exact.

/**
 * The cursor rendering of `events.starts_at` — ISO-8601 UTC with microseconds,
 * so `Date.parse` still accepts it (it truncates the extra digits) while
 * Postgres reads it back at full precision.
 */
export const eventCursorInstant = sql<string>`to_char(${events.startsAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** An event row plus the exact cursor token of its position in the order tuple. */
export type PublicEventRow = Event & { startsAtCursor: string };

/**
 * `(starts_at, id) > (cursor.startsAt, cursor.id)` as a keyset comparison.
 * Both operands are cast explicitly — the cursor's text would otherwise meet a
 * `timestamptz` / `uuid` column as `text`.
 */
export function afterEventCursor(after: {
  startsAt: string;
  id: string;
}): SQL {
  return sql`(${events.startsAt} > ${after.startsAt}::timestamptz
    OR (${events.startsAt} = ${after.startsAt}::timestamptz
        AND ${events.id} > ${after.id}::uuid))`;
}
