import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { type Event, events } from "@ds/db";

// 012-design §5.2 — the ONE keyset-cursor rule of every event-ordered public
// read: the two RELATIONSHIP traversals `/public/projects/:key/events` and
// `/public/directions/:key/events` (012 EARS-12, #1294), and the base event
// collection `/public/events` (014 EARS-11, #1888), which pages the same
// `(starts_at, id)` tuple in BOTH directions. The event↔experts item routes
// still carry their own cursor arithmetic; folding them in is #1880, not a
// claim this module makes today.
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
export function afterEventCursor(after: { startsAt: string; id: string }): SQL {
  return sql`(${events.startsAt} > ${after.startsAt}::timestamptz
    OR (${events.startsAt} = ${after.startsAt}::timestamptz
        AND ${events.id} > ${after.id}::uuid))`;
}

/**
 * `(starts_at, id) < (cursor.startsAt, cursor.id)` — the same keyset comparison
 * mirrored for a DESCENDING page, which the newest-first archive tab of the base
 * event collection reads (014 EARS-11). Same casting discipline as
 * {@link afterEventCursor}: the direction of the operators is the only
 * difference, so the exactness of the cutoff cannot drift between the two.
 */
export function beforeEventCursor(before: {
  startsAt: string;
  id: string;
}): SQL {
  return sql`(${events.startsAt} < ${before.startsAt}::timestamptz
    OR (${events.startsAt} = ${before.startsAt}::timestamptz
        AND ${events.id} < ${before.id}::uuid))`;
}

/**
 * The grammar `eventCursorInstant` emits, as the ONLY accepted `startsAt`.
 *
 * `to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` renders exactly four year digits,
 * zero-padded fields and six fractional digits, so a cursor that deviates was
 * not issued here. That distinction is load-bearing rather than cosmetic: the
 * value is handed back to Postgres as `$n::timestamptz`, so "V8 could parse it"
 * is the wrong acceptance test — `Date.parse` accepts strings Postgres refuses
 * (`0000-01-01T00:00:00Z` → `22008` year zero, a `Date.prototype.toString`
 * rendering → `22007` bad format), and such a string would surface on a
 * ZERO-AUTH route as an opaque 500 instead of the 400 `CURSOR_INVALID` that
 * EARS-12/EARS-16 contract.
 *
 * Year `0000` is excluded because Postgres has no year zero; every other
 * `0001`–`9999` instant is inside its `timestamptz` range.
 *
 * The regex cannot see the calendar, and neither can `Date.parse`: V8 ROLLS
 * impossible days over rather than refusing them (`2020-02-31` becomes 2 March,
 * `2021-02-29` becomes 1 March, hour `24` becomes the next midnight), while
 * Postgres answers `22008`. So the second half is a ROUND TRIP instead: the
 * millisecond prefix of the value must come back byte-for-byte out of
 * `Date.prototype.toISOString`, which only a real instant does. The three
 * microsecond digits the round trip drops are already pinned by the regex.
 */
const EVENT_CURSOR_INSTANT =
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * True only for a string this API's encoder could have produced: the exact
 * grammar, and a date the calendar actually has.
 */
function isEventCursorInstant(value: string): boolean {
  if (!EVENT_CURSOR_INSTANT.test(value)) return false;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return false;
  return instant.toISOString() === `${value.slice(0, 23)}Z`;
}

/**
 * The §5.2 event order tuple as a shape: an instant in exactly the cursor
 * grammar plus the tie-breaking UUID. A cursor is caller-supplied bytes, and
 * its decoded values become SQL operands — parsing the tuple refuses a
 * malformed one before any query runs.
 *
 * This is SHAPE-level validation, not authentication: the cursor is unsigned,
 * so a hand-built value in the right grammar is accepted as a legitimate
 * position. That is not a leak — these routes are zero-auth reads of published
 * rows, and a caller can walk the same rows page by page anyway. What the shape
 * buys is that no caller-chosen string ever reaches Postgres as an operand it
 * cannot read.
 */
export const EVENT_CURSOR_SHAPE = z
  .object({
    startsAt: z
      .string()
      .refine(isEventCursorInstant, "not a cursor instant issued by this API"),
    id: z.uuid(),
  })
  .strict();
