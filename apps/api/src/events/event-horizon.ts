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
 * `from` defaults to today for «Будущие» and to the window ending today for
 * «Прошедшие»; `to` defaults to one horizon width on. A caller-supplied `to` is
 * CLAMPED to the maximum rather than rejected — a hand-edited URL degrades to
 * the widest honest read, never to a 400.
 */
export function resolveEventHorizon(
  query: {
    tense: "upcoming" | "past";
    from?: string | undefined;
    to?: string | undefined;
  },
  today: string,
): EventHorizon {
  const past = query.tense === "past";
  const from =
    query.from ??
    (past
      ? addDoctorEventsFeedDays(today, -DOCTOR_EVENTS_FEED_HORIZON_DAYS)
      : today);
  const fallbackTo = past
    ? addDoctorEventsFeedDays(today, 1)
    : addDoctorEventsFeedDays(from, DOCTOR_EVENTS_FEED_HORIZON_DAYS);
  const requested = query.to ?? fallbackTo;

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
 * The `to` «показать ещё» leads to — or `null` when the control must not be
 * offered at all (#1803).
 *
 * The horizon width alone cannot answer this. A window that simply ends says
 * nothing about whether ANYTHING lies past it, and naming a next `to`
 * regardless offered a control that walked into an empty widening. So the
 * question is asked of the data, under the SAME predicate the read itself
 * selects with (the caller's `findFirstStartAfter`): is there an eligible event
 * in `[to, from + MAX)`?
 *
 * When there is, the step is walked WHOLE rather than once: the answer is the
 * smallest `to + k * STEP` (k ≥ 1, clamped to the maximum horizon) strictly
 * past the day that event falls on, so the widening handed to the viewer always
 * contains at least that event.
 */
export async function resolveNextHorizonTo(
  horizon: EventHorizon,
  findFirstStartAfter: (range: {
    fromInstant: Date;
    toInstant: Date;
  }) => Promise<Date | null>,
): Promise<string | null> {
  const width = doctorEventsFeedHorizonWidth(horizon.from, horizon.to);
  if (width >= DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) return null;

  const maxTo = addDoctorEventsFeedDays(
    horizon.from,
    DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
  );
  const firstStart = await findFirstStartAfter({
    fromInstant: new Date(`${horizon.to}T00:00:00+03:00`),
    toInstant: new Date(`${maxTo}T00:00:00+03:00`),
  });
  if (firstStart === null) return null;

  const gap = doctorEventsFeedHorizonWidth(
    horizon.to,
    doctorEventsFeedDayOf(firstStart),
  );
  const steps = Math.floor(gap / DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS) + 1;
  return addDoctorEventsFeedDays(
    horizon.from,
    Math.min(
      width + steps * DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
      DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
    ),
  );
}
