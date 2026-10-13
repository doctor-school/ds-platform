import {
  addDoctorEventsFeedDays,
  DOCTOR_EVENTS_FEED_STEP_EVENTS,
  DOCTOR_EVENTS_QUERY_YEAR_MAX,
  doctorEventsFeedDayOf,
  doctorEventsFeedHorizonWidth,
} from "@ds/schemas";

/**
 * The LD-2 bounded horizon of the one listing codec (019 LD-1, LD-2) — ONE
 * resolution for both storefront reads: the doctor feed
 * (`GET /v1/storefront/doctor/events`) and the Academy listing
 * (`GET /v1/public/events?timeframe=…&from=…&to=…`, wave-2 entry gate §4.3 D2).
 * A second copy would let «Показать ещё» mean two different widenings on the
 * two hosts of one module.
 */
export interface EventHorizon {
  /** First МСК day of the window (inclusive), `YYYY-MM-DD`. */
  from: string;
  /** МСК day the window ends before (exclusive), `YYYY-MM-DD`. */
  to: string;
}

/**
 * The extent a read STATES, before the data is asked: «Будущие» anchors on
 * `from` (default today) and moves `to`; «Прошедшие» anchors on `to` (default
 * tomorrow, so today's ended эфиры read) and moves `from` BACKWARD. A moving
 * edge the URL leaves unstated is the data's ({@link
 * resolveEventHorizonFromData}); the one-day extent here is only the
 * nothing-in-this-tense extent.
 *
 * Neither tense has a far bound inside the served years: «Будущие» reaches an
 * event however far ahead and «Прошедшие» (the archive, 014) however long ago,
 * so a hand-edited bound is honoured as written — the response stays bounded
 * by {@link EVENT_HORIZON_ROW_CAP} and the echo by {@link clampRequestedEdge}.
 * A bound outside `DOCTOR_EVENTS_QUERY_YEAR_MIN`–`_MAX` (1900–2999) never
 * reaches here: the read codec refuses it with a 400 (019 EARS-8.17).
 */
export function resolveEventHorizon(
  query: {
    tense: "upcoming" | "past";
    from?: string | undefined;
    to?: string | undefined;
  },
  today: string,
): EventHorizon {
  if (query.tense === "past") {
    const to = query.to ?? addDoctorEventsFeedDays(today, 1);
    const from = query.from ?? addDoctorEventsFeedDays(to, -1);
    if (doctorEventsFeedHorizonWidth(from, to) <= 0) {
      return { from: addDoctorEventsFeedDays(to, -1), to };
    }
    return { from, to };
  }

  const from = query.from ?? today;
  const to = query.to ?? addDoctorEventsFeedDays(from, 1);
  if (doctorEventsFeedHorizonWidth(from, to) <= 0) {
    return { from, to: addDoctorEventsFeedDays(from, 1) };
  }
  return { from, to };
}

/**
 * Both tenses page by COUNT (019 LD-2): the default screen and every «Показать
 * ещё» step hold this many events — «Будущие» the next later ones, «Прошедшие»
 * the next older ones.
 */
export const EVENT_HORIZON_STEP = DOCTOR_EVENTS_FEED_STEP_EVENTS;

/**
 * The first МСК day past the served years — «Будущие»'s reach has no far bound
 * short of it, as «Прошедшие»'s has no older one (`fromInstant: null`).
 */
const EVENT_HORIZON_SERVED_END = `${DOCTOR_EVENTS_QUERY_YEAR_MAX + 1}-01-01`;

/**
 * The moving-edge bound that takes in the next {@link EVENT_HORIZON_STEP}
 * events of `starts` (all beyond the current extent, in the tense's
 * direction), in whole МСК days, so a day the step's last event shares with
 * further ones is shown whole: «Прошедшие» the `from` that is the day of the
 * step's oldest event; «Будущие» the exclusive `to` that is the day after the
 * step's latest event. `null` when `starts` is empty.
 */
function stepBound(
  starts: readonly Date[],
  tense: "upcoming" | "past",
): string | null {
  if (starts.length === 0) return null;
  const nearestFirst = starts
    .map((start) => start.getTime())
    .sort((a, b) => (tense === "past" ? b - a : a - b));
  const last =
    nearestFirst[Math.min(EVENT_HORIZON_STEP, nearestFirst.length) - 1]!;
  const day = doctorEventsFeedDayOf(new Date(last));
  return tense === "past" ? day : addDoctorEventsFeedDays(day, 1);
}

/**
 * Everything a tense can still reach past an extent's moving edge: «Будущие»
 * from `to` on, «Прошедшие» every event before `from`.
 */
function reachBeyond(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
): EventHorizonReach {
  const window = eventHorizonInstants(horizon);
  return tense === "past"
    ? { fromInstant: null, toInstant: window.fromInstant }
    : { fromInstant: window.toInstant, toInstant: servedEndInstant() };
}

function servedEndInstant(): Date {
  return eventHorizonInstants({
    from: EVENT_HORIZON_SERVED_END,
    to: EVENT_HORIZON_SERVED_END,
  }).toInstant;
}

/**
 * The horizon a storefront read answers — {@link resolveEventHorizon}, except
 * that a read leaving its tense's moving edge unstated («Будущие» `to`,
 * «Прошедшие» `from`) opens on the {@link EVENT_HORIZON_STEP} events nearest
 * the fixed edge, however far away (019 LD-2). `listStartsIn` is the read's
 * own predicate, every facet applied — the same callback
 * {@link resolveEventHorizonBeyond} asks — so the default screen counts exactly
 * the events the read then shows. A stated edge is a real extent and is
 * answered as written.
 */
export async function resolveEventHorizonFromData(
  query: {
    tense: "upcoming" | "past";
    from?: string | undefined;
    to?: string | undefined;
  },
  today: string,
  listStartsIn: (range: EventHorizonReach) => Promise<readonly Date[]>,
): Promise<EventHorizon> {
  const stated = resolveEventHorizon(query, today);
  const past = query.tense === "past";
  if ((past ? query.from : query.to) !== undefined) return stated;
  // The whole tense from the fixed edge: an empty extent at that edge.
  const fixed: EventHorizon = past
    ? { from: stated.to, to: stated.to }
    : { from: stated.from, to: stated.from };
  const bound = stepBound(
    await listStartsIn(reachBeyond(fixed, query.tense)),
    query.tense,
  );
  if (bound === null) return stated;
  return resolveEventHorizon(
    past ? { ...query, from: bound } : { ...query, to: bound },
    today,
  );
}

/**
 * The most rows ONE horizon response carries, on both reads and both tenses.
 * «Прошедшие» has no age floor, so without it a hand-edited `from=1900-01-01`
 * would answer the whole archive in one response. At the real volume (~45
 * events a month per host) a «Показать ещё» walk crosses it within about a
 * year — {@link boundEventHorizonRows} then slides the window instead of
 * growing it.
 */
export const EVENT_HORIZON_ROW_CAP = 500;

/**
 * The order a horizon read selects its `EVENT_HORIZON_ROW_CAP + 1` rows in:
 * FROM THE MOVING EDGE — the edge «Показать ещё» advances. «Прошедшие» widens
 * `from` backward, so it reads oldest first; «Будущие» widens `to`, so it reads
 * farthest first. The cap then keeps the rows adjacent to that edge — the
 * batch the viewer just asked for.
 */
export const EVENT_HORIZON_READ_ORDER = {
  past: "asc",
  upcoming: "desc",
} as const satisfies Record<"upcoming" | "past", "asc" | "desc">;

/**
 * Bounds ONE horizon response (wave-2 gate row 32, both reads). `rows` are the
 * window's rows in {@link EVENT_HORIZON_READ_ORDER} — from the moving edge —
 * fetched with `limit: EVENT_HORIZON_ROW_CAP + 1`; they are returned in DISPLAY
 * order («Прошедшие» newest first, «Будущие» soonest first).
 *
 * An extent holding more than the cap keeps the cap's rows ADJACENT TO THE
 *   MOVING EDGE in WHOLE days: the day the cap splits is dropped and the FIXED
 *   edge moves past it — «Прошедшие» `to` down to the cut day, «Будущие»
 *   `from` up past it. «Показать ещё» writes both returned bounds into the URL,
 *   so the next step reads a window rather than a growing list: the moving
 *   edge strictly advances, every step brings the batch it named, the page
 *   never holds more than the cap, and the walk ends exactly when nothing lies
 *   beyond. Only a single day holding more than the cap is cut inside the day
 *   (the response stays bounded regardless; the fixed edge keeps that day).
 */
export function boundEventHorizonRows<T extends { startsAt: Date }>(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  rows: readonly T[],
): { horizon: EventHorizon; rows: T[] } {
  if (rows.length <= EVENT_HORIZON_ROW_CAP) {
    return { horizon, rows: [...rows].reverse() };
  }
  const cutDay = doctorEventsFeedDayOf(rows[EVENT_HORIZON_ROW_CAP]!.startsAt);
  const capped = rows.slice(0, EVENT_HORIZON_ROW_CAP);
  const whole = capped.filter(
    (row) => doctorEventsFeedDayOf(row.startsAt) !== cutDay,
  );
  if (whole.length === 0) {
    // One day holds more than the cap: the cut falls inside it.
    return {
      horizon:
        tense === "past"
          ? { from: horizon.from, to: addDoctorEventsFeedDays(cutDay, 1) }
          : { from: cutDay, to: horizon.to },
      rows: capped.reverse(),
    };
  }
  return {
    horizon:
      tense === "past"
        ? { from: horizon.from, to: cutDay }
        : { from: addDoctorEventsFeedDays(cutDay, 1), to: horizon.to },
    rows: whole.reverse(),
  };
}

/**
 * A REQUESTED moving edge past EVERY matching event (nothing lies beyond the
 * extent) is echoed clamped to the farthest matching event's day — «Прошедшие»
 * `from` up to the earliest event's day, «Будущие» `to` down to the day after
 * the latest event: the same rows, nothing lost, and a hand-edited
 * `from=1900-01-01` / `to=2999-12-31` never comes back as the extent. An edge
 * with events beyond it is a real «Показать ещё» bound and is echoed as
 * written. `rows` are the window's rows in display order (nearest first).
 */
export function clampRequestedEdge(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  rows: readonly { startsAt: Date }[],
  requested: { from?: string | undefined; to?: string | undefined },
  beyond: EventHorizonBeyond,
): EventHorizon {
  const stated = tense === "past" ? requested.from : requested.to;
  if (stated === undefined || rows.length === 0 || beyond.remaining > 0) {
    return horizon;
  }
  const farthest = doctorEventsFeedDayOf(rows[rows.length - 1]!.startsAt);
  if (tense === "past") {
    return farthest > horizon.from
      ? { from: farthest, to: horizon.to }
      : horizon;
  }
  const to = addDoctorEventsFeedDays(farthest, 1);
  return to < horizon.to ? { from: horizon.from, to } : horizon;
}

/** The half-open UTC instant range `[from 00:00 МСК, to 00:00 МСК)` of a horizon. */
export function eventHorizonInstants(horizon: EventHorizon): {
  fromInstant: Date;
  toInstant: Date;
} {
  return {
    fromInstant: new Date(`${horizon.from}T00:00:00+03:00`),
    toInstant: new Date(`${horizon.to}T00:00:00+03:00`),
  };
}

/**
 * The whole range a tense can reach from a horizon — the requested window plus
 * everything «Показать ещё» could add: «Будущие» every event from `from` on,
 * «Прошедшие» every event before `to`. The base a facet panel's option counts
 * read over (wave-2 gate §4.3 D9), so an option never names an event no
 * widening of this page would show.
 */
export function eventHorizonTenseReach(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
): EventHorizonReach {
  const window = eventHorizonInstants(horizon);
  return tense === "past"
    ? { fromInstant: null, toInstant: window.toInstant }
    : { fromInstant: window.fromInstant, toInstant: servedEndInstant() };
}

/**
 * The range «what lies beyond» is asked of: half-open `[fromInstant,
 * toInstant)`; `fromInstant: null` = no older bound — the whole archive before
 * `toInstant` («Прошедшие» has no age floor); «Будущие»'s reach ends only with
 * the served years.
 */
export interface EventHorizonReach {
  fromInstant: Date | null;
  toInstant: Date;
}

/**
 * What lies beyond a rendered extent: the next bound «Показать ещё» writes into
 * the URL and the remainder M of «Показать ещё N (осталось M)» (wave-2 entry
 * gate rows 30, 32; 019 LD-1, LD-2, LD-13). ONE answer for both storefront
 * reads, carried under the same names on both.
 */
export interface EventHorizonBeyond {
  /** «Будущие»: the next (later) `to`; `null` on «Прошедшие» and when nothing lies beyond. */
  nextTo: string | null;
  /** «Прошедшие»: the next (older) `from`; `null` on «Будущие» and when nothing lies beyond. */
  nextFrom: string | null;
  /** Matching events still reachable beyond the extent. `0` ⇔ both bounds `null`. */
  remaining: number;
  /**
   * Matching events the NEXT step adds — inside `[nextFrom, from)` /
   * `[to, nextTo)` — the N of «Показать ещё N (осталось M)»; `0` ⇔ both
   * bounds `null`.
   */
  nextBatch: number;
}

/**
 * Resolves {@link EventHorizonBeyond} from the data, never from the window
 * width alone (#1803): a window that simply ends says nothing about whether
 * ANYTHING lies past it.
 *
 * The question is asked of everything past the moving edge — from `to` on for
 * «Будущие», everything before `from` for «Прошедшие» — under the SAME
 * predicate the read itself selects with: the caller's `listStartsIn` returns
 * the start instant of every eligible event in that range, after every facet
 * the read applies, so the remainder and the bound can never count an event
 * the widened read would then not show. Both tenses step by COUNT (019 LD-2):
 * the next bound takes in the next {@link EVENT_HORIZON_STEP} events in the
 * tense's direction, in whole days.
 */
export async function resolveEventHorizonBeyond(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  listStartsIn: (range: EventHorizonReach) => Promise<readonly Date[]>,
): Promise<EventHorizonBeyond> {
  const starts = await listStartsIn(reachBeyond(horizon, tense));
  const bound = stepBound(starts, tense);
  if (bound === null) {
    return { nextTo: null, nextFrom: null, remaining: 0, nextBatch: 0 };
  }
  // The same half-open instants the widened read selects with.
  const widened = eventHorizonInstants(
    tense === "past"
      ? { from: bound, to: horizon.to }
      : { from: horizon.from, to: bound },
  );
  const nextBatch = starts.filter((start) =>
    tense === "past"
      ? start.getTime() >= widened.fromInstant.getTime()
      : start.getTime() < widened.toInstant.getTime(),
  ).length;
  return {
    nextTo: tense === "past" ? null : bound,
    nextFrom: tense === "past" ? bound : null,
    remaining: starts.length,
    nextBatch,
  };
}

/**
 * #1973 — the DEFAULT extent opens on the first match. When the URL leaves the
 * tense's moving edge unstated («Будущие» `to`, «Прошедшие» `from`) and the
 * default window holds no matching event while matches lie beyond, the read
 * is answered over the extent «Показать ещё» would name next — `beyond`'s
 * bound, which by construction covers the nearest match — instead of an empty
 * window under a non-zero count. ONE rule for both storefront reads; a stated
 * edge is a real extent and is answered as written. Returns the bound to read
 * with, or `null` to keep the window.
 */
export function eventHorizonReachingFirstMatch(
  query: {
    tense: "upcoming" | "past";
    from?: string | undefined;
    to?: string | undefined;
  },
  matched: number,
  beyond: EventHorizonBeyond,
): { from: string } | { to: string } | null {
  if (matched > 0 || beyond.remaining === 0) return null;
  if (query.tense === "past") {
    return query.from === undefined && beyond.nextFrom !== null
      ? { from: beyond.nextFrom }
      : null;
  }
  return query.to === undefined && beyond.nextTo !== null
    ? { to: beyond.nextTo }
    : null;
}
