import type { ApiEnv } from "../config/env.schema.js";

/**
 * 044 — the single place the public congress intake learns WHICH event it
 * registers for, WHICH consent version it stamps, WHERE the congress is held
 * and WHEN it is willing to accept a submission.
 *
 * Settings that a reader would otherwise have to hunt for across a controller, a
 * service and an env schema, kept together because they answer one question:
 * «is this submission acceptable at all, and against what?». All of them come
 * from server configuration, the two window instants included: the opening and
 * closing date-times differ per environment — the dev-stand and the stage slot
 * each need a window that is open right now for the intake to be exercisable at
 * all, while production needs the owner's real dates — and moving a date the
 * owner approved must not take an API release (#2348, owner decision
 * 2026-09-22; the real closing date lands through #2292). They fail CLOSED like
 * every other key here: unset, unparseable or inverted refuses the submission
 * through the one generic refusal, so a deployment that forgot them takes no
 * registrations rather than taking them unbounded.
 */

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

/**
 * 044 EARS-28 — an ISO-8601 date-time that states its own offset.
 *
 * The offset is REQUIRED, and that is the whole point of validating the shape
 * rather than trusting `Date.parse`: the API runs in UTC and the congress is in
 * Moscow, so `2026-10-01T00:00:00` parses happily and opens registration three
 * hours before the date the owner approved. An operator must write the offset
 * they mean — `+03:00` or `Z`.
 */
const ISO_INSTANT_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

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
   * Configuration and NOT an `events` column: this is one congress, and the
   * venue is a constant of it. Adding a venue column to `events` would put
   * a field on every webinar in the catalogue — none of which has a place —
   * purely so one mail can name one address, and 044 explicitly adds no new
   * admin-editable setting. It is trimmed and required: a confirmation email
   * that says «зарегистрированы на …: 12 марта, .» is worse than a refused
   * submission the operator can see in the log.
   */
  eventVenue: string;
  /**
   * 044 EARS-28 — the registration window, as the operator CONFIGURED it.
   *
   * Kept as the configured strings rather than `Date`s because the opening
   * instant is echoed to the caller verbatim: the congress site renders it, and
   * an operator who wrote a Moscow offset must not see their own date announced
   * in UTC. The parsing happens where the comparison happens.
   */
  windowOpensAt: string;
  windowClosesAt: string;
}

/** Why the congress configuration cannot be used, for the server log only. */
export type CongressSignUpConfigProblem =
  | "event-id-unset"
  | "event-id-malformed"
  | "consent-version-unset"
  | "consent-version-malformed"
  | "event-venue-unset"
  | "window-opens-at-unset"
  | "window-opens-at-malformed"
  | "window-closes-at-unset"
  | "window-closes-at-malformed"
  | "window-not-ordered"
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
  | "CONGRESS_SIGNUP_WINDOW_OPENS_AT"
  | "CONGRESS_SIGNUP_WINDOW_CLOSES_AT"
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

/** One configured window instant, or why it is unusable. */
type WindowInstantResult =
  | { ok: true; value: string }
  | { ok: false; kind: "unset" | "malformed" };

/**
 * 044 EARS-28 — read ONE configured window instant.
 *
 * Both the shape and `Date.parse` have to agree: the pattern rejects a
 * date-time that names no offset, and the parse rejects one that is shaped like
 * a date-time but is not a real instant (`2026-13-01T00:00:00.000+03:00`).
 */
function readWindowInstant(raw: string | undefined): WindowInstantResult {
  const value = raw?.trim();
  if (value == null || value === "") return { ok: false, kind: "unset" };
  if (!ISO_INSTANT_WITH_OFFSET_PATTERN.test(value)) {
    return { ok: false, kind: "malformed" };
  }
  if (Number.isNaN(Date.parse(value))) return { ok: false, kind: "malformed" };
  return { ok: true, value };
}

/**
 * 044 EARS-5 / EARS-9 / EARS-28 — read and validate the configured settings.
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

  // EARS-28 — the window is configuration like the rest, and validated HERE so
  // an unusable window refuses the submission through the SAME generic refusal
  // rather than through a window refusal: «регистрация ещё не открыта» to every
  // submitter is what a typo in an offset looks like from outside, and it would
  // read to the operator as the clock rather than as their own key.
  const opensAt = readWindowInstant(env.CONGRESS_SIGNUP_WINDOW_OPENS_AT);
  if (!opensAt.ok) {
    return { ok: false, reason: `window-opens-at-${opensAt.kind}` };
  }
  const closesAt = readWindowInstant(env.CONGRESS_SIGNUP_WINDOW_CLOSES_AT);
  if (!closesAt.ok) {
    return { ok: false, reason: `window-closes-at-${closesAt.kind}` };
  }
  // Strictly after: equal instants are a window that is never open, and an
  // inverted pair is one too — both refuse every submitter, silently.
  if (Date.parse(closesAt.value) <= Date.parse(opensAt.value)) {
    return { ok: false, reason: "window-not-ordered" };
  }

  // EARS-7 — validated HERE, with the others, so a misconfigured floor
  // refuses the submission before any side effect and through the same generic
  // refusal, rather than silently running the intake at the default floor.
  const timingFloor = resolveCongressSignUpTimingFloorMs(env);
  if (!timingFloor.ok) return { ok: false, reason: timingFloor.reason };

  return {
    ok: true,
    settings: {
      eventId,
      consentVersion,
      eventVenue,
      windowOpensAt: opensAt.value,
      windowClosesAt: closesAt.value,
    },
  };
}

/** 044 EARS-28 — where `now` falls relative to the registration window. */
export type CongressSignUpWindowState =
  | { state: "open" }
  | { state: "not-yet-open"; opensAt: string }
  | { state: "closed" };

/** 044 EARS-28 — the configured window, as the settings carry it. */
export interface CongressSignUpWindow {
  opensAt: string;
  closesAt: string;
}

/**
 * 044 EARS-28 — decide the window from an INJECTED instant and the CONFIGURED
 * one.
 *
 * `now` is a parameter rather than a `new Date()` inside the function: that is
 * the whole clock seam. The before / inside / after cases of a window whose
 * boundaries are months away are otherwise untestable, and an untested window is
 * exactly the kind of check that turns out to be inverted on the morning it
 * first matters.
 *
 * The window is a parameter for the same reason it is configuration: the suites
 * that drive the intake, the dev-stand and production all need different
 * instants, and reading them here would put an environment lookup inside a pure
 * comparison.
 *
 * The opening instant is INSIDE the window and the closing instant is OUTSIDE
 * it (half-open interval), so the two never both accept or both refuse the same
 * millisecond. `opensAt` travels back to the caller exactly as configured — the
 * congress site renders that string.
 */
export function resolveCongressSignUpWindow(
  now: Date,
  window: CongressSignUpWindow,
): CongressSignUpWindowState {
  const at = now.getTime();
  if (at < Date.parse(window.opensAt)) {
    return { state: "not-yet-open", opensAt: window.opensAt };
  }
  if (at >= Date.parse(window.closesAt)) {
    return { state: "closed" };
  }
  return { state: "open" };
}
