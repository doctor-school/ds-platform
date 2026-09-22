import type { ApiEnv } from "../config/env.schema.js";

/**
 * 044 — the single place the public congress intake learns WHICH event it
 * registers for, WHICH consent version it stamps, and WHEN it is willing to
 * accept a submission.
 *
 * Three settings that a reader would otherwise have to hunt for across a
 * controller, a service and an env schema, kept together because they answer one
 * question: «is this submission acceptable at all, and against what?». Two come
 * from server configuration (they differ per environment / per published text);
 * the two window instants are code constants, because the registration window is
 * a product decision recorded in the 044 spec, not an operator knob — an
 * operator who could move the opening date by editing an env file could open
 * registration before the congress site is live.
 */

/**
 * 044 EARS-28 — the instant the congress registration window OPENS: Moscow
 * midnight on 2026-10-01 (the congress's own timezone; the platform's audience
 * and the organiser are both there, so an offset-less UTC constant would be a
 * silent three-hour shift of a date the owner approved).
 */
export const CONGRESS_SIGN_UP_WINDOW_OPENS_AT = "2026-10-01T00:00:00.000+03:00";

/**
 * 044 EARS-28 — the instant the window CLOSES.
 *
 * PROVISIONAL. The owner's real closing date lands through #2292; until it does,
 * a far-future-but-real instant is used rather than «no close at all», so the
 * closed branch is live code exercised by tests instead of a path that first
 * runs the day someone fills a date in.
 */
export const CONGRESS_SIGN_UP_WINDOW_CLOSES_AT =
  "2027-01-01T00:00:00.000+03:00";

/**
 * 044 EARS-9 / ADR-0009 §2.1 — the shape of a consent version: the publication
 * date of the consent text, then the sha256 of the published text.
 *
 * Validated rather than trusted because the value is operator-supplied. A
 * version that is not a real digest of a real published text makes the
 * `consent_records` row unverifiable — the one thing an append-only consent
 * ledger exists to avoid — so a malformed value refuses the intake outright
 * instead of being stamped as-is.
 */
export const CONGRESS_SIGN_UP_CONSENT_VERSION_PATTERN =
  /^\d{4}-\d{2}-\d{2}\.sha256-[0-9a-f]{64}$/;

/**
 * 044 EARS-7 — the DEFAULT route-specific timing floor (ms) for the intake.
 *
 * The platform-wide 40 ms auth-door floor equalises nothing here: the
 * new-account branch creates a user in the IdP and commits a whole transaction,
 * and the existing-account branch resolves an account and attaches a
 * registration. Both run well past 40 ms, so a 40 ms floor pads neither and the
 * full work difference — which is exactly «did this address already have an
 * account?» — stays measurable on the wire.
 *
 * One second is a deliberately CONSERVATIVE floor: it must exceed the heaviest
 * branch (a real Zitadel create plus the transaction) for the equalization to
 * hold at all, and the cost of overshooting is a slower congress form, while the
 * cost of undershooting is the existence oracle EARS-7 exists to close.
 * Calibrating it to ≥ the p99 of the new-account path as measured on prod is an
 * ops task — which is why it is configuration and not a constant.
 */
export const CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS = 1000;

/** A uuid, checked here so the config unit needs no Zod round-trip at request time. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configuration the intake needs to write anything at all. */
export interface CongressSignUpSettings {
  /** The event every congress submission is registered for (EARS-5). */
  eventId: string;
  /** The version stamped on the personal-data consent row (EARS-9). */
  consentVersion: string;
  /**
   * 044 EARS-13 — the «{место}» line of the confirmation email.
   *
   * Configuration and NOT an `events` column, for the same reason the window
   * instants are code constants rather than a knob: this is one congress, and
   * the venue is a constant of it. Adding a venue column to `events` would put
   * a field on every webinar in the catalogue — none of which has a place —
   * purely so one mail can name one address, and 044 explicitly adds no new
   * admin-editable setting. It is trimmed and required: a confirmation email
   * that says «зарегистрированы на …: 12 марта, .» is worse than a refused
   * submission the operator can see in the log.
   */
  eventVenue: string;
}

/** Why the congress configuration cannot be used, for the server log only. */
export type CongressSignUpConfigProblem =
  | "event-id-unset"
  | "event-id-malformed"
  | "consent-version-unset"
  | "consent-version-malformed"
  | "event-venue-unset"
  | "timing-floor-malformed";

export type CongressSignUpConfigResult =
  | { ok: true; settings: CongressSignUpSettings }
  | { ok: false; reason: CongressSignUpConfigProblem };

/** The environment slice this unit reads — nothing else. */
export type CongressSignUpEnv = Pick<
  Partial<ApiEnv>,
  | "CONGRESS_SIGNUP_EVENT_ID"
  | "CONGRESS_SIGNUP_CONSENT_VERSION"
  | "CONGRESS_SIGNUP_EVENT_VENUE"
  | "CONGRESS_SIGNUP_TIMING_FLOOR_MS"
>;

/** 044 EARS-7 — the resolved timing floor, or why the configured one is unusable. */
export type CongressSignUpTimingFloorResult =
  | { ok: true; floorMs: number }
  | { ok: false; reason: "timing-floor-malformed" };

/**
 * 044 EARS-7 — read the route-specific timing floor.
 *
 * An UNSET key is not a problem: the conservative default applies, and every
 * runtime that does not host the intake boots unchanged. A SET but unusable
 * value is a problem, and deliberately not silently defaulted: an operator who
 * typed `1s` instead of `1000` would otherwise believe the floor they wrote is
 * the floor that runs.
 */
export function resolveCongressSignUpTimingFloorMs(
  env: CongressSignUpEnv,
): CongressSignUpTimingFloorResult {
  const raw = env.CONGRESS_SIGNUP_TIMING_FLOOR_MS;
  if (raw == null || raw === "") {
    return { ok: true, floorMs: CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS };
  }
  if (!/^\d+$/.test(raw)) return { ok: false, reason: "timing-floor-malformed" };
  const floorMs = Number(raw);
  if (!Number.isSafeInteger(floorMs)) {
    return { ok: false, reason: "timing-floor-malformed" };
  }
  return { ok: true, floorMs };
}

/**
 * 044 EARS-7 — the floor the `@TimingEqualized` metadata on the intake route
 * carries, read per request.
 *
 * A function rather than a value because a decorator argument is evaluated once
 * at class-definition time, while this module's rule is that configuration is
 * read per request: an operator raising the floor after a live measurement must
 * not need a redeploy.
 *
 * It reads the ONE key it needs straight off `process.env` rather than
 * re-validating the whole api environment on every request: the interceptor
 * calls this before each intake, and a `z.looseObject` parse of the entire
 * environment to answer a single key is cost with no reader.
 *
 * It never throws and never returns the malformed value: an unusable floor falls
 * back to the conservative default, which is the SAFE direction (too slow, never
 * too fast). The submission itself is then refused generically by
 * {@link resolveCongressSignUpSettings} before any side effect, so the operator
 * still learns the configuration is broken — from the server log, on the same
 * request, and without the endpoint having run with a half-configured meaning.
 */
export function readCongressSignUpTimingFloorMs(): number {
  const resolved = resolveCongressSignUpTimingFloorMs({
    CONGRESS_SIGNUP_TIMING_FLOOR_MS:
      process.env["CONGRESS_SIGNUP_TIMING_FLOOR_MS"],
  });
  return resolved.ok
    ? resolved.floorMs
    : CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS;
}

/**
 * 044 EARS-5 / EARS-9 — read and validate the two configured settings.
 *
 * Returns a result rather than throwing, and the `reason` is deliberately NOT
 * something the caller may put on the wire: every configuration problem must
 * reach the submitter as the one generic refusal every submitter gets, so a
 * misconfigured deployment cannot be probed from outside. The reason exists for
 * the operator reading the server log.
 */
export function resolveCongressSignUpSettings(
  env: CongressSignUpEnv,
): CongressSignUpConfigResult {
  const eventId = env.CONGRESS_SIGNUP_EVENT_ID;
  if (eventId == null || eventId === "") {
    return { ok: false, reason: "event-id-unset" };
  }
  if (!UUID_PATTERN.test(eventId)) {
    return { ok: false, reason: "event-id-malformed" };
  }

  const consentVersion = env.CONGRESS_SIGNUP_CONSENT_VERSION;
  if (consentVersion == null || consentVersion === "") {
    return { ok: false, reason: "consent-version-unset" };
  }
  if (!CONGRESS_SIGN_UP_CONSENT_VERSION_PATTERN.test(consentVersion)) {
    return { ok: false, reason: "consent-version-malformed" };
  }

  // EARS-13 — validated HERE with the rest, and BEFORE any side effect: the
  // venue is only read once the registration has committed and the mail is
  // being built, so a deployment that forgot the key would otherwise register
  // participants for weeks and only then discover it cannot describe the event
  // to them. Failing the submission closed instead keeps «accepted» meaning
  // «and you will be told where to come».
  const eventVenue = env.CONGRESS_SIGNUP_EVENT_VENUE?.trim();
  if (eventVenue == null || eventVenue === "") {
    return { ok: false, reason: "event-venue-unset" };
  }

  // EARS-7 — validated HERE, with the other two, so a misconfigured floor
  // refuses the submission before any side effect and through the same generic
  // refusal, rather than silently running the intake at the default floor.
  const timingFloor = resolveCongressSignUpTimingFloorMs(env);
  if (!timingFloor.ok) return { ok: false, reason: timingFloor.reason };

  return { ok: true, settings: { eventId, consentVersion, eventVenue } };
}

/** 044 EARS-28 — where `now` falls relative to the registration window. */
export type CongressSignUpWindowState =
  | { state: "open" }
  | { state: "not-yet-open"; opensAt: string }
  | { state: "closed" };

/**
 * 044 EARS-28 — decide the window from an INJECTED instant.
 *
 * `now` is a parameter rather than a `new Date()` inside the function: that is
 * the whole clock seam. The before / inside / after cases of a window whose
 * boundaries are months away are otherwise untestable, and an untested window is
 * exactly the kind of check that turns out to be inverted on the morning it
 * first matters.
 *
 * The opening instant is INSIDE the window and the closing instant is OUTSIDE
 * it (half-open interval), so the two constants never both accept or both refuse
 * the same millisecond.
 */
export function resolveCongressSignUpWindow(
  now: Date,
): CongressSignUpWindowState {
  const at = now.getTime();
  if (at < Date.parse(CONGRESS_SIGN_UP_WINDOW_OPENS_AT)) {
    return { state: "not-yet-open", opensAt: CONGRESS_SIGN_UP_WINDOW_OPENS_AT };
  }
  if (at >= Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT)) {
    return { state: "closed" };
  }
  return { state: "open" };
}
