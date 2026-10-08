import {
  addDoctorEventsFeedDays,
  DOCTOR_EVENTS_FEED_HORIZON_DAYS,
  DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
  DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
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
 * «Будущие» anchors on `from` (default today) and widens `to`; «Прошедшие»
 * anchors on `to` (default tomorrow, so today's ended эфиры read) and widens
 * `from` BACKWARD (default one horizon width before today).
 *
 * Only «Будущие» has a widest horizon: a hand-edited `to` past it is CLAMPED
 * rather than rejected — a hand-edited URL degrades to the widest honest read,
 * never to a 400. «Прошедшие» is the archive and has NO age floor (014 reaches
 * every past event): any older `from` is honoured as written.
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
    const from =
      query.from ??
      addDoctorEventsFeedDays(today, -DOCTOR_EVENTS_FEED_HORIZON_DAYS);
    if (doctorEventsFeedHorizonWidth(from, to) <= 0) {
      return { from: addDoctorEventsFeedDays(to, -1), to };
    }
    return { from, to };
  }

  const from = query.from ?? today;
  const requested =
    query.to ?? addDoctorEventsFeedDays(from, DOCTOR_EVENTS_FEED_HORIZON_DAYS);
  const width = doctorEventsFeedHorizonWidth(from, requested);
  if (width <= 0) return { from, to: addDoctorEventsFeedDays(from, 1) };
  if (width > DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) {
    return {
      from,
      to: addDoctorEventsFeedDays(from, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
    };
  }
  return { from, to: requested };
}

/**
 * The most rows ONE horizon response carries, on both reads and both tenses.
 * «Прошедшие» has no age floor, so without it a hand-edited `from=1900-01-01`
 * would answer the whole archive in one response. Generous against the real
 * volume (~45 events a month per host): the default 14-day extent and every
 * honest «Показать ещё» walk stay far below it.
 */
export const EVENT_HORIZON_ROW_CAP = 500;

/**
 * Bounds ONE horizon response (wave-2 gate row 32, both reads). `rows` are the
 * window's rows in read order — «Прошедшие» newest first, «Будущие» soonest
 * first — fetched with `limit: EVENT_HORIZON_ROW_CAP + 1`.
 *
 * An extent holding more than the cap keeps the cap's newest («Прошедшие»)
 *   / soonest («Будущие») rows in WHOLE days: the day the cap splits is
 *   dropped and the moving bound (`from` / `to`) shrinks past it, so the
 *   «Показать ещё» resolution asked of the returned extent stays truthful and
 *   the dropped day is the next step. Only a single day holding more than the
 *   cap is cut inside the day (the response stays bounded regardless).
 */
export function boundEventHorizonRows<T extends { startsAt: Date }>(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  rows: readonly T[],
): { horizon: EventHorizon; rows: T[] } {
  if (rows.length > EVENT_HORIZON_ROW_CAP) {
    const cutDay = doctorEventsFeedDayOf(rows[EVENT_HORIZON_ROW_CAP]!.startsAt);
    const whole = rows
      .slice(0, EVENT_HORIZON_ROW_CAP)
      .filter((row) => doctorEventsFeedDayOf(row.startsAt) !== cutDay);
    if (whole.length === 0) {
      return {
        horizon:
          tense === "past"
            ? { from: cutDay, to: horizon.to }
            : { from: horizon.from, to: addDoctorEventsFeedDays(cutDay, 1) },
        rows: rows.slice(0, EVENT_HORIZON_ROW_CAP),
      };
    }
    return {
      horizon:
        tense === "past"
          ? { from: addDoctorEventsFeedDays(cutDay, 1), to: horizon.to }
          : { from: horizon.from, to: cutDay },
      rows: whole,
    };
  }
  return { horizon, rows: [...rows] };
}

/**
 * A REQUESTED «Прошедшие» `from` older than EVERY matching event (nothing lies
 * beyond the extent) is echoed clamped up to the earliest matching event's day
 * — the same rows, nothing lost, and a hand-edited `from=1900-01-01` never
 * comes back as the extent. A `from` with older events beyond it is a real
 * «Показать ещё» bound and is echoed as written. `rows` are the window's rows
 * newest first.
 */
export function clampRequestedPastFrom(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  rows: readonly { startsAt: Date }[],
  requestedFrom: string | undefined,
  beyond: EventHorizonBeyond,
): EventHorizon {
  if (
    tense !== "past" ||
    requestedFrom === undefined ||
    rows.length === 0 ||
    beyond.remaining > 0
  ) {
    return horizon;
  }
  const earliest = doctorEventsFeedDayOf(rows[rows.length - 1]!.startsAt);
  return earliest > horizon.from ? { from: earliest, to: horizon.to } : horizon;
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
 * The range «what lies beyond» is asked of: half-open `[fromInstant,
 * toInstant)`; `fromInstant: null` = no older bound — the whole archive before
 * `toInstant` («Прошедшие» has no age floor).
 */
export interface EventHorizonReach {
  fromInstant: Date | null;
  toInstant: Date;
}

/**
 * What lies beyond a rendered extent: the next bound «Показать ещё» writes into
 * the URL and the remainder M of «Показать ещё N из M» (wave-2 entry gate rows
 * 30, 32; 019 LD-1, LD-2, LD-13). ONE answer for both storefront reads, carried
 * under the same names on both.
 */
export interface EventHorizonBeyond {
  /** «Будущие»: the next `to`; `null` on «Прошедшие» and when nothing lies beyond. */
  nextTo: string | null;
  /** «Прошедшие»: the next (older) `from`; `null` on «Будущие» and when nothing lies beyond. */
  nextFrom: string | null;
  /**
   * Matching events still reachable beyond the extent — «Будущие»: up to the
   * widest horizon; «Прошедшие»: every older event. `0` ⇔ both bounds `null`.
   */
  remaining: number;
  /**
   * Matching events the NEXT step adds — inside `[nextFrom, from)` /
   * `[to, nextTo)` — the N of «Показать ещё N из M»; `0` ⇔ both bounds `null`.
   */
  nextBatch: number;
}

/**
 * Resolves {@link EventHorizonBeyond} from the data, never from the window
 * width alone (#1803): a window that simply ends says nothing about whether
 * ANYTHING lies past it, and naming a next bound regardless offered a control
 * that walked into an empty widening.
 *
 * The question is asked of the reachable range — `[to, from + MAX)` for
 * «Будущие», everything before `from` for «Прошедшие» — under the SAME predicate the
 * read itself selects with: the caller's `listStartsIn` returns the start
 * instant of every eligible event in that range, after every facet the read
 * applies, so the remainder and the bound can never count an event the
 * widened read would then not show.
 *
 * The step is walked WHOLE rather than once: the next bound is the nearest
 * `to + k·STEP` (upcoming, clamped to the widest horizon) / `from − k·STEP`
 * (past, unclamped), k ≥ 1, that still covers the nearest event beyond — so
 * the widening handed to the viewer always contains at least that event.
 */
export async function resolveEventHorizonBeyond(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  listStartsIn: (range: EventHorizonReach) => Promise<readonly Date[]>,
): Promise<EventHorizonBeyond> {
  const none: EventHorizonBeyond = {
    nextTo: null,
    nextFrom: null,
    remaining: 0,
    nextBatch: 0,
  };
  const width = doctorEventsFeedHorizonWidth(horizon.from, horizon.to);
  const STEP = DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS;

  if (tense === "past") {
    const starts = await listStartsIn({
      fromInstant: null,
      toInstant: eventHorizonInstants(horizon).fromInstant,
    });
    if (starts.length === 0) return none;
    const times = starts.map((start) => start.getTime());
    // The newest event older than `from`: `from − k·STEP` must fall on or
    // before its day, and the gap is at least one day (it starts before `from`).
    const nearestDay = doctorEventsFeedDayOf(new Date(Math.max(...times)));
    const gap = doctorEventsFeedHorizonWidth(nearestDay, horizon.from);
    const steps = Math.ceil(gap / STEP);
    const nextFrom = addDoctorEventsFeedDays(horizon.from, -steps * STEP);
    // The same half-open instants the widened read selects with.
    const { fromInstant } = eventHorizonInstants({
      from: nextFrom,
      to: horizon.to,
    });
    return {
      nextTo: null,
      nextFrom,
      remaining: starts.length,
      nextBatch: times.filter((time) => time >= fromInstant.getTime()).length,
    };
  }

  if (width >= DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) return none;
  const starts = await listStartsIn(
    eventHorizonInstants({
      from: horizon.to,
      to: addDoctorEventsFeedDays(
        horizon.from,
        DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
      ),
    }),
  );
  if (starts.length === 0) return none;
  const times = starts.map((start) => start.getTime());

  // The earliest event at or after `to`: `to + k·STEP` must fall strictly past its day.
  const nearestDay = doctorEventsFeedDayOf(new Date(Math.min(...times)));
  const gap = doctorEventsFeedHorizonWidth(horizon.to, nearestDay);
  const steps = Math.floor(gap / STEP) + 1;
  const nextTo = addDoctorEventsFeedDays(
    horizon.from,
    Math.min(width + steps * STEP, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
  );
  const { toInstant } = eventHorizonInstants({
    from: horizon.from,
    to: nextTo,
  });
  return {
    nextTo,
    nextFrom: null,
    remaining: starts.length,
    nextBatch: times.filter((time) => time < toInstant.getTime()).length,
  };
}
