"use client";

import type { RegistrationIntent } from "@ds/schemas";

import { registerForEvent } from "./registration-client";

/**
 * 005 EARS-2 — resume the carried event-registration once the 003 session exists.
 *
 * A guest who activated «Участвовать» is taken through the shipped 003
 * login/signup flow carrying a safe, same-origin registration-intent (the event
 * slug + the event page's returnTo — an `@ds/schemas` shape guard). The DECISION
 * RULE below is one rule for both storefronts; what differs between them is only
 * WHICH shapes count as this host's own, which the host injects as a
 * {@link ReturnHost}. The parsers themselves stay in `@ds/schemas` (the academy
 * shape `parseAcademyEventReturnTarget`, the doctor shapes
 * `parseDoctorEventReturnTarget` / `parseDoctorHostReturnTarget`), so no host and
 * no package re-declares what a safe target looks like.
 *
 * This module is the RESUME side of that handoff, run by the auth pages the moment
 * a session is established (password + OTP success, post-registration auto-login):
 * it fires the SAME `RegisterForEvent` (EARS-1) and lands the doctor back on that
 * event page in the registered state — no re-search, no second «Участвовать» tap,
 * the event context intact across the round-trip.
 *
 * There is NO server-side "postponed registration" record (the retired legacy
 * mechanism): the intent lived only in the round-trip's returnTo, and the real
 * command fires once, here, after the session exists (design §3.2).
 *
 * The CARRY side — parking the target when the visitor enters the auth flow and
 * consuming it once on the way out (014 EARS-6) — is the HOST's, because the
 * parking store is per-host. The host resolves + consumes the target and hands
 * {@link completeReturnTarget} the already-resolved raw value.
 */

/**
 * The host's projection of the shared rule: which return shapes this storefront
 * recognises, and where it lands a visitor who carried nothing.
 */
export interface ReturnHost {
  /**
   * This host's room-return shape (006 EARS-6), or a function returning `null`
   * when the host mounts no room.
   */
  readonly parseRoomReturn: (returnTo: string | null) => { returnTo: string } | null;
  /** This host's event-registration intent shape (an `@ds/schemas` guard). */
  readonly parseIntent: (returnTo: string | null) => RegistrationIntent | null;
  /** Where the visitor lands when no valid target survived (008 EARS-7 / 013 EARS-15). */
  readonly defaultLanding: string;
}

/**
 * Read the carried `returnTo` off the current URL's query, if any. Runs only in
 * the browser (the auth success handlers are client-side); returns `null` on the
 * server or when the param is absent.
 */
export function currentReturnTarget(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("returnTo");
}

/**
 * Defence in depth for the LAST branch below. The host has already run its own
 * same-origin guard while consuming the parked target, so everything arriving
 * here is guard-clean; this repeats the value-level rejections (cross-origin,
 * protocol-relative, backslash trick, traversal) so that the one branch which
 * returns the carried value VERBATIM can never become an open redirect if a host
 * ever wires the call without resolving first. It adds no new rule — it is the
 * same rule, applied again.
 */
function isSafeSameOriginPath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  const path = value.split(/[?#]/, 1)[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed escape is not a path anyone was consuming.
    return false;
  }
  return !decoded.split("/").includes("..");
}

/**
 * Given the raw (already host-resolved) `returnTo` carried through auth, complete
 * the registration and return WHERE to land:
 *   • a room-return → land back on the room, fire NO registration (006 EARS-6);
 *   • a SAFE event intent → fire `RegisterForEvent` for its slug, then land on the
 *     event page (`intent.returnTo`), already registered (EARS-2);
 *   • any other safe same-origin page → land there, register nothing (014 EARS-6);
 *   • no / an unsafe target → the host's default landing (008 EARS-7 as amended by
 *     013 EARS-15) — never an open redirect.
 *
 * The register call is best-effort: if it throws (a transient error, a gating
 * refusal), the doctor is still landed on the event page — the per-user
 * registered-state read (EARS-4) or a retry surfaces there — never stranded on
 * the default listing. Firing again on a retry is a server-side idempotent no-op
 * (EARS-3).
 */
export async function completeReturnTarget(
  rawReturnTo: string | null,
  host: ReturnHost,
): Promise<string> {
  // 013 EARS-15 stands: `/` is the storefront's MARKETING landing, never a
  // login-gated page anyone was consuming, and no post-login flow may strand a
  // doctor there. It is therefore not a return target — it falls through to the
  // host's default landing.
  const carried = rawReturnTo === "/" ? null : rawReturnTo;
  // 006 EARS-6 — a visitor bounced from the room to auth carries a ROOM return.
  // On success route BACK to the room so the server-side gate RE-EVALUATES; fire
  // NO registration — an unauthenticated visitor is never silently joined to the
  // roster (a still-unregistered doctor is then guided to register by the
  // re-evaluation, not auto-admitted). Checked before the registration-intent so
  // the room's trailing `/room` is not mistaken for an event-page intent.
  const roomReturn = host.parseRoomReturn(carried);
  if (roomReturn) return roomReturn.returnTo;

  const intent = host.parseIntent(carried);
  if (!intent) {
    // 014 EARS-6 — any OTHER safe same-origin origin page is honoured as-is: no
    // registration fires (there is no event to register for), the visitor is
    // simply returned to the page they were consuming. The default landing is
    // reached only when no valid target survived at all. A shape belonging to the
    // OTHER storefront is not an intent here (019 EARS-12): it registers nothing
    // and is never treated as this host's event page.
    return carried && isSafeSameOriginPath(carried)
      ? carried
      : host.defaultLanding;
  }
  try {
    await registerForEvent(intent.eventSlug);
  } catch {
    // Best-effort — land on the event page regardless; never strand the doctor.
  }
  return intent.returnTo;
}
