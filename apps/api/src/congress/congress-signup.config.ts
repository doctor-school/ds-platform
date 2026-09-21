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

/** A uuid, checked here so the config unit needs no Zod round-trip at request time. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configuration the intake needs to write anything at all. */
export interface CongressSignUpSettings {
  /** The event every congress submission is registered for (EARS-5). */
  eventId: string;
  /** The version stamped on the personal-data consent row (EARS-9). */
  consentVersion: string;
}

/** Why the congress configuration cannot be used, for the server log only. */
export type CongressSignUpConfigProblem =
  | "event-id-unset"
  | "event-id-malformed"
  | "consent-version-unset"
  | "consent-version-malformed";

export type CongressSignUpConfigResult =
  | { ok: true; settings: CongressSignUpSettings }
  | { ok: false; reason: CongressSignUpConfigProblem };

/** The environment slice this unit reads — nothing else. */
export type CongressSignUpEnv = Pick<
  Partial<ApiEnv>,
  "CONGRESS_SIGNUP_EVENT_ID" | "CONGRESS_SIGNUP_CONSENT_VERSION"
>;

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

  return { ok: true, settings: { eventId, consentVersion } };
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
