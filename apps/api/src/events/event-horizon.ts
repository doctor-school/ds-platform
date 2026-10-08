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
 * `from` BACKWARD (default one horizon width before today). A hand-edited bound
 * past the widest horizon is CLAMPED at the far end rather than rejected — a
 * hand-edited URL degrades to the widest honest read, never to a 400, and the
 * clamp never cuts the anchored (recent) end of a past read.
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
    const width = doctorEventsFeedHorizonWidth(from, to);
    if (width <= 0) return { from: addDoctorEventsFeedDays(to, -1), to };
    if (width > DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) {
      return {
        from: addDoctorEventsFeedDays(to, -DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
        to,
      };
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
  /** Matching events the widest horizon still reaches beyond the extent; `0` ⇔ both bounds `null`. */
  remaining: number;
}

/**
 * Resolves {@link EventHorizonBeyond} from the data, never from the window
 * width alone (#1803): a window that simply ends says nothing about whether
 * ANYTHING lies past it, and naming a next bound regardless offered a control
 * that walked into an empty widening.
 *
 * The question is asked of the reachable range — `[to, from + MAX)` for
 * «Будущие», `[to − MAX, from)` for «Прошедшие» — under the SAME predicate the
 * read itself selects with: the caller's `listStartsIn` returns the start
 * instant of every eligible event in that range, after every facet the read
 * applies, so the remainder and the bound can never count an event the
 * widened read would then not show.
 *
 * The step is walked WHOLE rather than once: the next bound is the nearest
 * `to + k·STEP` (upcoming) / `from − k·STEP` (past), k ≥ 1, clamped to the
 * widest horizon, that still covers the nearest event beyond — so the widening
 * handed to the viewer always contains at least that event.
 */
export async function resolveEventHorizonBeyond(
  horizon: EventHorizon,
  tense: "upcoming" | "past",
  listStartsIn: (range: {
    fromInstant: Date;
    toInstant: Date;
  }) => Promise<readonly Date[]>,
): Promise<EventHorizonBeyond> {
  const none: EventHorizonBeyond = {
    nextTo: null,
    nextFrom: null,
    remaining: 0,
  };
  const width = doctorEventsFeedHorizonWidth(horizon.from, horizon.to);
  if (width >= DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) return none;

  const past = tense === "past";
  const reach = past
    ? {
        from: addDoctorEventsFeedDays(
          horizon.to,
          -DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
        ),
        to: horizon.from,
      }
    : {
        from: horizon.to,
        to: addDoctorEventsFeedDays(
          horizon.from,
          DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
        ),
      };
  const starts = await listStartsIn(eventHorizonInstants(reach));
  if (starts.length === 0) return none;

  const times = starts.map((start) => start.getTime());
  const STEP = DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS;
  if (past) {
    // The newest event older than `from`: `from − k·STEP` must fall on or
    // before its day, and the gap is at least one day (it starts before `from`).
    const nearestDay = doctorEventsFeedDayOf(new Date(Math.max(...times)));
    const gap = doctorEventsFeedHorizonWidth(nearestDay, horizon.from);
    const steps = Math.ceil(gap / STEP);
    return {
      nextTo: null,
      nextFrom: addDoctorEventsFeedDays(
        horizon.to,
        -Math.min(width + steps * STEP, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
      ),
      remaining: starts.length,
    };
  }

  // The earliest event at or after `to`: `to + k·STEP` must fall strictly past its day.
  const nearestDay = doctorEventsFeedDayOf(new Date(Math.min(...times)));
  const gap = doctorEventsFeedHorizonWidth(horizon.to, nearestDay);
  const steps = Math.floor(gap / STEP) + 1;
  return {
    nextTo: addDoctorEventsFeedDays(
      horizon.from,
      Math.min(width + steps * STEP, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
    ),
    nextFrom: null,
    remaining: starts.length,
  };
}
