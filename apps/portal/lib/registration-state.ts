import type { EventRegistrationState } from "@ds/schemas";

import type { CanvasStatus } from "./event-lifecycle";

/**
 * 005 EARS-4 — the per-user `EventRegistrationState` composed onto the 004 event
 * page, WITHOUT contaminating 004's public, cacheable projection.
 *
 * 004's `GetPublicEventPage` (`lib/public-events`) stays public, cookie-free, and
 * content-identical for guest and principal. The doctor's registration state is a
 * SEPARATE authenticated read (design §4): this module fetches
 * `GET /v1/events/:idOrSlug/registration` server-side, forwarding the session
 * cookie of the incoming request, and never touches the public fetch or its
 * shared data cache. A guest (no session) simply gets `null` here and sees 004's
 * register CTA.
 *
 * The upstream is the same env-driven `API_PROXY_TARGET` the portal's rewrite +
 * the public reader use (`next.config.ts` / `lib/public-events`) — never a
 * hardcoded host, so dev and prod differ by config only.
 */
const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/**
 * The incoming request's fingerprint surface the authenticated read must forward.
 * The BFF session is **fingerprint-bound** (ADR-0001 §6 / 003 design §3:
 * `hash(user-agent + IP/24 + accept-language)`) — the api re-derives the
 * fingerprint on every read and rejects a cookie whose surface diverges from the
 * one bound at login. A server-to-server SSR read on the doctor's behalf must
 * therefore present the SAME `user-agent` + `accept-language` as the browser, not
 * just the cookie — otherwise the api sees a fingerprint mismatch and 401s. The
 * IP/24 already matches: the portal→api hop originates from one host (dev) / the
 * one portal service IP (prod), the same source the browser's login rode through.
 */
export interface ForwardedSession {
  cookie: string;
  userAgent: string;
  acceptLanguage: string;
}

/**
 * Read the calling doctor's registration state for `idOrSlug`, forwarding the
 * incoming request's session cookie AND its fingerprint headers so the api
 * resolves + re-derives the `__Host-` session server-side. Returns:
 *   • `{ registered, registeredAt? }` for an authenticated caller;
 *   • `null` when the caller is unauthenticated (401 — a guest / a fingerprint
 *     mismatch), the cookie header is empty, or the event is not found (404) —
 *     every "no per-user state to compose" case collapses to `null`, and the page
 *     falls back to 004's public render.
 *
 * Per-user ⇒ never shared-cacheable: `cache: "no-store"` keeps this read out of
 * the data cache that backs the public projection (design §5).
 */
export async function fetchEventRegistrationState(
  idOrSlug: string,
  session: ForwardedSession,
): Promise<EventRegistrationState | null> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return null;

  const res = await fetch(
    `${API_BASE}/v1/events/${encodeURIComponent(idOrSlug)}/registration`,
    {
      headers: {
        accept: "application/json",
        cookie: session.cookie,
        // Forward the fingerprint surface (ADR-0001 §6) — without it the api
        // re-derives a different fingerprint and 401s a valid session.
        "user-agent": session.userAgent,
        "accept-language": session.acceptLanguage,
      },
      // Per-user, authenticated — MUST NOT be shared-cached (design §5).
      cache: "no-store",
    },
  );
  // 401 (guest / expired), 404 (unknown event) → no state to compose; fall back
  // to the public render rather than surfacing an error on the public page.
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`registration state fetch failed (${res.status})`);
  }
  return (await res.json()) as EventRegistrationState;
}

/**
 * 005 EARS-5 — the registered doctor's join-signpost render mode: HOW/WHEN they
 * will join, layered on top of the 004 lifecycle render (`lib/event-lifecycle`).
 * The signpost derives from the registration state + the canvas lifecycle
 * `status` — never from the primary CTA (a registered doctor has no register
 * CTA to key off). There are exactly two signpost renders plus the fall-through:
 *
 *   • `upcoming` — the doctor is registered on an `upcoming` (`published`)
 *     event: signpost that they are registered and when the broadcast starts
 *     (date/time МСК). The register CTA is replaced by a static confirmation —
 *     no second action (EARS-4/EARS-5).
 *   • `live` — the doctor is registered on a `live` event: signpost that the
 *     broadcast is on and they are on the participant list. The interactive
 *     onward-to-room affordance is the 006 room surface (#584) — until the room
 *     ships, the signpost is textual (a `/room` link would be a dead link / 404,
 *     a banned pattern; the deferral is tracked on #584).
 *   • `none` — every other case: `ended` / `archived` (no participation CTA — 004
 *     owns those renders), an unregistered doctor, or a guest (004's register CTA
 *     stands). No signpost is composed onto the public page.
 */
export type JoinSignpost =
  | { readonly kind: "upcoming" }
  | { readonly kind: "live" }
  | { readonly kind: "none" };

export function resolveJoinSignpost(
  state: EventRegistrationState | null,
  status: CanvasStatus,
): JoinSignpost {
  // Only an authenticated, registered caller ever gets a signpost — a guest
  // (null) or an unregistered doctor sees 004's public render unchanged.
  if (state?.registered !== true) return { kind: "none" };
  switch (status) {
    // Upcoming (`published`) → the register CTA is replaced by the confirmation +
    // МСК start signpost.
    case "upcoming":
      return { kind: "upcoming" };
    // Live → the confirmation + "the broadcast is on" signpost (the room link
    // arrives with the 006 room surface, #584).
    case "live":
      return { kind: "live" };
    // `ended` / `archived` carry no participation CTA — no signpost (004 owns it).
    default:
      return { kind: "none" };
  }
}

/**
 * 005 EARS-4 — the pure state→render decision: show the registered confirmation
 * (replacing the register CTA) exactly when the caller is registered AND the page
 * would otherwise render the 004 «Участвовать» REGISTER CTA for an upcoming /
 * `published` event. This is exactly the `upcoming` arm of
 * {@link resolveJoinSignpost} — the register-CTA swap.
 *
 * The registered-`live` render is EARS-5's `live` signpost (the confirmation +
 * "the broadcast is on"), not this primitive; `ended` / `archived` carry no
 * register CTA at all. So a registered doctor is never shown the register CTA as
 * if unregistered (EARS-4 invariant), and no other lifecycle affordance is
 * disturbed.
 */
export function showRegisteredConfirmation(
  state: EventRegistrationState | null,
  status: CanvasStatus,
): boolean {
  return resolveJoinSignpost(state, status).kind === "upcoming";
}
