// #2063 — the pinned «now» of the golden dataset (staging tech spec §4).
//
// Every timestamp the golden dataset writes is derived from ONE instant. Nothing
// in the dataset may read the wall clock: two builds of `ds_golden` a week apart
// must produce byte-identical data, so that `pg_dump --data-only` of build N and
// build N+1 differ in nothing at all (the §9 «Golden seed drift» rule). The only
// sanctioned variation is an explicit `GOLDEN_NOW` override, which the drift
// test uses to prove that the WHOLE dataset moves with the pin rather than a
// subset of it.

/**
 * The pinned instant the golden dataset is built around. A Thursday midday UTC,
 * chosen so that «+3 days» and «-3 days» never land on a month or year boundary
 * and so the local-time rendering on the Moscow-facing storefront (UTC+3) stays
 * inside the same calendar day.
 */
export const GOLDEN_NOW_DEFAULT = "2026-01-15T12:00:00.000Z";

/** Environment variable that overrides {@link GOLDEN_NOW_DEFAULT}. */
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
 * Resolves the pinned instant from the environment.
 *
 * Throws rather than falling back to the wall clock or to the default when an
 * override is present but malformed: an operator who sets `GOLDEN_NOW` and gets
 * a silently ignored value would ship a template database that does not match
 * the scenario fixtures built against it.
 */
export function resolveGoldenNow(
  env: Record<string, string | undefined> = process.env,
): Date {
  const raw = env[GOLDEN_NOW_ENV_VAR] ?? GOLDEN_NOW_DEFAULT;
  if (!GOLDEN_NOW_PATTERN.test(raw)) {
    throw new GoldenNowError(
      `${GOLDEN_NOW_ENV_VAR} must be an ISO-8601 UTC instant with millisecond precision (e.g. ${GOLDEN_NOW_DEFAULT}), got: ${raw}`,
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

/** A signed offset from the pinned instant. Every field is optional. */
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
 * Derives an instant relative to the pin. This is the ONLY way the dataset is
 * allowed to produce a timestamp — a literal date in a row would not move when
 * `GOLDEN_NOW` moves, and the drift test would not catch it.
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
