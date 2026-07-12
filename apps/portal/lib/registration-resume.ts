"use client";

import { parseReturnTarget } from "@ds/schemas";

import { registerForEvent } from "./registration-client";
import { parseRoomReturnTarget } from "./room-return";

/**
 * 005 EARS-2 — resume the carried event-registration once the 003 session exists.
 *
 * A guest who activated «Участвовать» is taken through the shipped 003
 * login/signup flow carrying a safe, same-origin registration-intent (the event
 * slug + a `/webinars/<slug>` returnTo — the `@ds/schemas` `parseReturnTarget`
 * guard). This module is the RESUME side of that handoff, run by the auth pages
 * the moment a session is established (`/login` password + OTP success, `/verify`
 * post-registration auto-login): it fires the SAME `RegisterForEvent` (EARS-1) and
 * lands the doctor back on that event page in the registered state — no re-search,
 * no second «Участвовать» tap, the event context intact across the round-trip.
 *
 * There is NO server-side "postponed registration" record (the retired legacy
 * mechanism): the intent lived only in the round-trip's returnTo, and the real
 * command fires once, here, after the session exists (design §3.2).
 */

/**
 * The default landing when no (or no safe) event context rode the round-trip.
 * #769 facade re-point — «Мои события» (`/account/events`, already
 * product-grade), not the 003-era `/account` session dump.
 */
const DEFAULT_LANDING = "/account/events";

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
 * Given the raw `returnTo` carried through auth, complete the registration and
 * return WHERE to land:
 *   • a SAFE event intent → fire `RegisterForEvent` for its slug, then land on the
 *     event page (`intent.returnTo`), already registered (EARS-2);
 *   • no / an unsafe target → the default «Мои события» landing
 *     (`/account/events`) — never an open redirect (an attacker-supplied
 *     cross-origin `returnTo` is dropped by the `parseReturnTarget` guard before
 *     it can be navigated to).
 *
 * The register call is best-effort: if it throws (a transient error, a gating
 * refusal), the doctor is still landed on the event page — the per-user
 * registered-state read (EARS-4) or a retry surfaces there — never stranded on
 * «Мои события». Firing again on a retry is a server-side idempotent no-op (EARS-3).
 */
export async function completeReturnTarget(
  rawReturnTo: string | null,
): Promise<string> {
  // 006 EARS-6 — a visitor bounced from the room to auth carries a ROOM return
  // (`/webinars/<slug>/room`). On success route BACK to the room so the
  // server-side gate RE-EVALUATES; fire NO registration — an unauthenticated
  // visitor is never silently joined to the roster (a still-unregistered doctor is
  // then guided to register by the re-evaluation, not auto-admitted). Checked
  // before the registration-intent so the room's trailing `/room` is not mistaken
  // for an event-page intent.
  const roomReturn = parseRoomReturnTarget(rawReturnTo);
  if (roomReturn) return roomReturn.returnTo;

  const intent = parseReturnTarget(rawReturnTo);
  if (!intent) return DEFAULT_LANDING;
  try {
    await registerForEvent(intent.eventSlug);
  } catch {
    // Best-effort — land on the event page regardless; never strand on /account.
  }
  return intent.returnTo;
}
