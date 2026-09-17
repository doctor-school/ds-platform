import type { DoctorConfirmResponse } from "@ds/schemas";

/**
 * 021 EARS-10 (amended 2026-09-17) — WHERE A CONFIRMED DOCTOR IS SENT.
 *
 * The clause used to end on a success card whose primary action carried this
 * href; the owner removed that step, so the same decision now feeds a
 * navigation instead of a button. The rule itself is unchanged, which is why it
 * still lives in one pure function: «where does a confirmed doctor go» is the
 * clause's whole substance, and a decision with no I/O in it is a decision a
 * unit test can pin without a browser.
 *
 * WHAT IT NEVER DOES (021-design §3, property 1): compose a destination. Every
 * href it returns is either the server's own reconstruction or the `landing`
 * the door already decided server-side. There is no `document.referrer`, no
 * storage read, and no string concatenated from the raw `returnTo` param.
 *
 * The href rule, in full:
 *
 * • `kind: "return"` — the carried point of interest is live and the server's
 *   href IS the guard's reconstruction of it. Use it.
 * • `kind: "landing"` WITH a `reason` — LD-8: a target was carried and went
 *   stale, and the server picked the nearest honest destination knowing WHY.
 *   Use it; the client has no better answer.
 * • `kind: "landing"` WITHOUT a `reason` — nothing was carried (or the value
 *   was hostile and treated as absent). The server's default is `/events`; the
 *   DOOR's `landingFallback` is the same LD-4 decision taken with the one fact
 *   the confirmation API does not have — 017's remembered specialty, read from
 *   the cookie on the register route — so the door's answer is the better one
 *   and the doctor lands where the door promised them they would.
 *
 * NOT `completeReturnTarget`'s RETURN VALUE. The 005 EARS-2 completion rule
 * also computes a landing, but it computes it from the CARRIED target alone and
 * knows nothing of the staleness the confirm route just observed — an эфир that
 * ended, filled up or was unpublished between the arrival and the code. The
 * confirm response is the one answer produced by the round trip that verified
 * the email, so it is the one this host navigates to.
 */
export function resolveConfirmLanding(
  response: DoctorConfirmResponse,
  landingFallback: string,
): string {
  const { primaryAction } = response;
  const honouredReturn = primaryAction.kind === "return";
  const degraded = primaryAction.reason !== undefined;
  return honouredReturn || degraded ? primaryAction.href : landingFallback;
}
