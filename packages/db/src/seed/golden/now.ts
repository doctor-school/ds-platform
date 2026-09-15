// #2063/#2212 — the «now» the golden dataset is built around (staging tech spec §4).
//
// Every timestamp the dataset writes is derived from ONE instant, and by default
// that instant is the SEED RUN TIME. The stand's apps read the real clock, so a
// dataset frozen at a literal date turns every «upcoming» event into a past one
// the moment the calendar moves past it — which is what «Расписание эфиров»
// rendered empty on the staging slot. Re-running the seed moves the whole
// schedule forward with it (the upsert refreshes every date-bearing column).
//
// `GOLDEN_NOW` is the explicit pin, and it is the reproducibility tool: the unit
// suite pins it so dataset assertions stay deterministic, and the §9 «Golden
// seed drift» rule runs BOTH builds under the same pin so a `pg_dump --data-only`
// difference means a defect in the dataset rather than the clock ticking.

/** Environment variable that pins the instant instead of using the run time. */
export const GOLDEN_NOW_ENV_VAR = "GOLDEN_NOW";

/**
 * Strict shape of an accepted pin: UTC, millisecond precision, `Z` suffix.
 *
 * Deliberately narrower than `Date.parse`. A pin of `2026-01-15` or
 * `2026-01-15T15:00+03:00` would parse, produce a different instant than it
 * reads as, and silently move the whole dataset — the exact class of drift this
 * module exists to prevent.
 */
const GOLDEN_NOW_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Raised for an unusable pin — the caller must fail closed, never fall back. */
export class GoldenNowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenNowError";
  }
}

/**
 * Resolves the instant the dataset is built around: the explicit `GOLDEN_NOW`
 * pin when one is set, otherwise the seed run time.
 *
 * A malformed pin throws rather than falling back to the clock: an operator who
 * sets `GOLDEN_NOW` and gets a silently ignored value would ship a template
 * database that does not match the scenario fixtures built against it.
 *
 * `clock` is an injection point for the tests only — production callers pass
 * nothing and get `new Date()`.
 */
export function resolveGoldenNow(
  env: Record<string, string | undefined> = process.env,
  clock: () => Date = () => new Date(),
): Date {
  const raw = env[GOLDEN_NOW_ENV_VAR];
  if (raw === undefined) return clock();
  if (!GOLDEN_NOW_PATTERN.test(raw)) {
    throw new GoldenNowError(
      `${GOLDEN_NOW_ENV_VAR} must be an ISO-8601 UTC instant with millisecond precision (e.g. 2026-01-15T12:00:00.000Z), got: ${raw}`,
    );
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== raw) {
    throw new GoldenNowError(
      `${GOLDEN_NOW_ENV_VAR} is not a real instant: ${raw}`,
    );
  }
  return at;
}

/** A signed offset from the resolved «now». Every field is optional. */
export interface GoldenOffset {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

const MS = {
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1000,
};

/**
 * Derives an instant relative to the resolved «now». This is the ONLY way the
 * dataset is allowed to produce a timestamp — a literal date in a row would move
 * neither with the run time nor with `GOLDEN_NOW`, so an «upcoming» event would
 * quietly rot into a past one and the drift test would not catch it.
 */
export function shiftFromNow(now: Date, offset: GoldenOffset): Date {
  const delta =
    (offset.days ?? 0) * MS.days +
    (offset.hours ?? 0) * MS.hours +
    (offset.minutes ?? 0) * MS.minutes +
    (offset.seconds ?? 0) * MS.seconds;
  return new Date(now.getTime() + delta);
}

/** `YYYY-MM-DD` in UTC — for the `date` columns (`events.recording_expected_by`). */
export function goldenDateOnly(at: Date): string {
  return at.toISOString().slice(0, 10);
}
