/**
 * 005 EARS-2 / 014 EARS-6 — the returnTo carry across the intermediate auth
 * navigations of the guest→auth→registered round-trip.
 *
 * The «Участвовать» href itself is NOT built here: since 020 EARS-1 (slice 3,
 * #1764) the participation CTA — label and `/register?returnTo=/webinars/<slug>`
 * target alike — is resolved server-side by
 * `apps/api/src/events/participation-cta.resolver.ts`, so one owner emits it and
 * two builders can no longer disagree. What stays portal-local is the ONWARD
 * carry below: re-appending an already-safe returnTo to the next auth hop.
 *
 * The invariant baked in here rather than left to the call site: **no
 * open-redirect** (005 Constraints, EARS-2) — a returnTo is re-appended only
 * after it passes the same-origin guards, and always in the canonical form the
 * guard reconstructs, never as raw input.
 */

import {
  parseAcademyEventReturnTarget,
  parseSameOriginReturnTarget,
} from "@ds/schemas";
import { parseRoomReturnTarget } from "@ds/room/room-return";

import { ACADEMY_ROOM_ROUTES } from "./room-config";

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
  const safe = safeReturnTarget(rawReturnTo);
  if (!safe) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}returnTo=${encodeURIComponent(safe)}`;
}

/**
 * The guard chain itself, named once (#2027 rule S3/S4). The CARRY above and any
 * surface that must decide «did this visitor arrive carrying anything at all?»
 * — `/reset`, whose landing is the #221 `/account` default exactly when they did
 * not — answer that question through THIS function, so a hostile value is refused
 * by the same three guards in the same order at every consumption point instead of
 * each caller re-assembling them.
 *
 * Three guards, narrowest first, because the narrower two also decide what happens
 * on ARRIVAL: the 005 registration-intent (`/webinars/<slug>`) additionally fires
 * `RegisterForEvent`, and the 006 room-return (`/webinars/<slug>/room`) additionally
 * re-runs the room gate. 014 EARS-6 then generalizes the carry to ANY same-origin
 * page, so a visitor sent to auth from any other login-gated surface keeps their
 * origin across the hop instead of silently losing it here. Returns the CANONICAL
 * form the guard reconstructs, never the raw input.
 */
export function safeReturnTarget(rawReturnTo: string | null): string | null {
  return (
    parseRoomReturnTarget(rawReturnTo, ACADEMY_ROOM_ROUTES)?.returnTo ??
    parseAcademyEventReturnTarget(rawReturnTo)?.returnTo ??
    parseSameOriginReturnTarget(rawReturnTo) ??
    null
  );
}
