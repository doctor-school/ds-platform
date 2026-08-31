/**
 * 004 EARS-3 — the event-context handoff carried by the single «Участвовать» CTA
 * into the registration flow (feature 005) through auth (feature 003).
 *
 * 004 owns **only** the CTA and this context handoff; the registration mechanics
 * and the guest→auth→registered round-trip are owned by 005/003 (a tracked seam,
 * parent #549 / design §8). The forward-compatible contract 005's design pins
 * (§3.2) is a **safe, same-origin registration-intent**: the event slug plus a
 * same-origin `returnTo=/webinars/:slug` path — never PII, never a credential.
 * The CTA routes the visitor into the shipped 003 registration entry (`/register`)
 * carrying that returnTo; 005 consumes it to fire `RegisterForEvent` after the
 * session exists and land the doctor back on the event page, registered.
 *
 * Two invariants are baked in here rather than left to the call site:
 *   • **No hardcoded origin** (004 Constraints) — the href is a same-origin
 *     RELATIVE path; the portal origin is never spelled out in code.
 *   • **No open-redirect** (005 Constraints, EARS-2) — the returnTo is always
 *     anchored under `/webinars/`, and the slug is `encodeURIComponent`-escaped,
 *     so a hostile slug (`//evil`, `https://evil`, `../..`) can never surface a
 *     protocol-relative or cross-origin return target.
 */

import { parseReturnTarget, parseSameOriginReturnTarget } from "@ds/schemas";

import { parseRoomReturnTarget } from "./room-return";

/** The shipped 003 registration entry the guest «Участвовать» path routes through. */
const REGISTRATION_ENTRY = "/register";

/**
 * Build the same-origin registration href the «Участвовать» CTA links to for an
 * event identified by `slug`, carrying the event context as a `returnTo` that
 * points back at the event's public page.
 */
export function buildRegistrationHref(slug: string): string {
  // Always anchored under the same-origin /webinars/ path; the slug is escaped so
  // a leading `//` or an absolute scheme can never reach the front of returnTo.
  const returnTo = `/webinars/${encodeURIComponent(slug)}`;
  const params = new URLSearchParams({ returnTo });
  return `${REGISTRATION_ENTRY}?${params.toString()}`;
}

/**
 * 005 EARS-2 / 014 EARS-6 — carry a `returnTo` ONWARD through an intermediate
 * auth navigation (e.g. `/register → /verify`, or a `/verify → /login` fallback),
 * appending it to `path` ONLY when it is a SAFE same-origin target. An absent or
 * hostile `returnTo` is dropped, so a cross-origin / open-redirect value can never
 * be propagated across the round-trip — the returnTo the next page reads is always
 * guard-clean, and the appended value is the canonical form the guard reconstructs,
 * never the raw input.
 */
export function withReturnTarget(
  path: string,
  rawReturnTo: string | null,
): string {
  // Three guards, narrowest first, because the narrower two also decide what
  // happens on ARRIVAL: the 005 registration-intent (`/webinars/<slug>`) additionally
  // fires `RegisterForEvent`, and the 006 room-return (`/webinars/<slug>/room`)
  // additionally re-runs the room gate. 014 EARS-6 then generalizes the carry to
  // ANY same-origin page, so a visitor sent to auth from any other login-gated
  // surface keeps their origin across the hop instead of silently losing it here.
  const safe =
    parseRoomReturnTarget(rawReturnTo)?.returnTo ??
    parseReturnTarget(rawReturnTo)?.returnTo ??
    parseSameOriginReturnTarget(rawReturnTo);
  if (!safe) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}returnTo=${encodeURIComponent(safe)}`;
}
