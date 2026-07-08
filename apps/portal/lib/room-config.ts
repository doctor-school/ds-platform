import type { RoomConfig } from "@ds/schemas";

import type { ForwardedSession } from "./registration-state";

/**
 * 006 EARS-1 (consumed) / EARS-2 — the authenticated server-side read of the
 * `RoomConfig` `RoomAccess` grant for the room surface.
 *
 * The room renders ONLY where the server-side gate issued a grant (authenticated
 * ∧ registered ∧ live). This module reads `GET /v1/events/:idOrSlug/room`
 * server-side, forwarding the incoming request's session cookie AND its
 * fingerprint headers (ADR-0001 §6) exactly as the 005 registration-state read
 * does — the BFF session is fingerprint-bound, so a server-to-server read on the
 * doctor's behalf must present the same `user-agent` + `accept-language` the
 * browser bound at login, or the api re-derives a different fingerprint and 401s.
 *
 * The gate's three refusals map to the EARS-6 access branches (owned by the
 * denied-access-routing handler; #578 consumes the grant and surfaces the branch
 * as a discriminated result, it does not re-implement the gate):
 *   • 401 → `auth`      (guest / expired / fingerprint mismatch) → route via 003;
 *   • 403 → `register`  (authenticated, not on the 005 roster)   → route via 005;
 *   • 409 → `not-live`  (registered, event not `live`)           → the 004 state;
 *   • 404 → `not-found` (unknown event / draft)                  → not-found.
 *
 * Per-caller (the grant is caller-scoped) ⇒ `cache: "no-store"`, never shared.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

export type RoomAccess =
  | { readonly kind: "granted"; readonly config: RoomConfig }
  | { readonly kind: "auth" }
  | { readonly kind: "register" }
  | { readonly kind: "not-live" }
  | { readonly kind: "not-found" };

export async function fetchRoomConfig(
  idOrSlug: string,
  session: ForwardedSession,
): Promise<RoomAccess> {
  // No session cookie rode the request → a guest; the gate would 401 anyway, so
  // short-circuit to the auth branch without issuing the read.
  if (!session.cookie) return { kind: "auth" };

  const res = await fetch(
    `${API_BASE}/v1/events/${encodeURIComponent(idOrSlug)}/room`,
    {
      headers: {
        accept: "application/json",
        cookie: session.cookie,
        // Forward the fingerprint surface (ADR-0001 §6) — without it the api
        // re-derives a different fingerprint and 401s a valid session.
        "user-agent": session.userAgent,
        "accept-language": session.acceptLanguage,
      },
      cache: "no-store",
    },
  );

  if (res.status === 401) return { kind: "auth" };
  if (res.status === 403) return { kind: "register" };
  if (res.status === 409) return { kind: "not-live" };
  if (res.status === 404) return { kind: "not-found" };
  if (!res.ok) {
    throw new Error(`room config fetch failed (${res.status})`);
  }
  return { kind: "granted", config: (await res.json()) as RoomConfig };
}
