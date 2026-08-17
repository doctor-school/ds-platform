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
 * The default landing when no (or no safe) return target rode the round-trip.
 *
 * 013 EARS-15 (US-10) — the post-login landing is the visitor’s captured
 * same-origin return target, and `/webinars` (the public upcoming-broadcasts
 * listing, feature-004 surface) whenever no valid target exists. This re-points
 * feature 008’s EARS-7 landing (008 requirements → «Amendment — 2026-08-17»):
 * `/` no longer redirects to the listing — it serves the Academy landing — so a
 * `/` default stranded a doctor on marketing copy after login. Never a scaffold,
 * never a dead dashboard; supersedes the #769 `/account/events` default.
 *
 * The return-target MECHANISM is feature 014’s (014 EARS-6, #1342): the shipped
 * same-origin guards below (`parseReturnTarget` / `parseRoomReturnTarget`) are
 * consumed as-is — 013 adds no second redirect rule (013 design §6, LD-12).
 */
const DEFAULT_LANDING = "/webinars";

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
 *   • no / an unsafe target → the default discovery listing landing (`/webinars`,
 *     008 EARS-7 as amended by 013 EARS-15) — never an open redirect (an
 *     attacker-supplied cross-origin `returnTo` is dropped by the
 *     `parseReturnTarget` guard before it can be navigated to).
 *
 * The register call is best-effort: if it throws (a transient error, a gating
 * refusal), the doctor is still landed on the event page — the per-user
 * registered-state read (EARS-4) or a retry surfaces there — never stranded on
 * the default listing. Firing again on a retry is a server-side idempotent no-op (EARS-3).
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
