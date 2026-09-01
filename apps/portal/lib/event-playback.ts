import type { EventPlayback } from "@ds/schemas";

import type { ForwardedSession } from "./registration-state";

/**
 * 014 EARS-5 — the AUTHENTICATED source read behind the recording player.
 *
 * `GET /v1/events/:idOrSlug/recordings` is the only source-bearing response in
 * feature 014 (design §5). It is deliberately a SECOND read rather than a field
 * on 004's public projection: the public read stays cookie-free, cacheable and
 * byte-identical for a guest and a signed-in doctor, and no playable source can
 * leak into a guest's HTML because the guest's render never issues this call.
 *
 * Session forwarding is the 005 `registration-state` mechanism unchanged (its
 * {@link ForwardedSession} is reused rather than re-declared): the BFF session is
 * fingerprint-bound (ADR-0001 §6), so a server-side read on the doctor's behalf
 * must present the browser's `user-agent` + `accept-language` alongside the
 * cookie or the api re-derives a different fingerprint and 401s a valid session.
 *
 * The upstream is the same env-driven `API_PROXY_TARGET` every other portal read
 * uses — never a hardcoded host, so dev and prod differ by config only.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Read the playable source for `idOrSlug` on the calling doctor's behalf.
 *
 * Returns `null` for every "no source to render" case — no session cookie rode
 * the request, the api answered 401 (a guest, an expired or
 * fingerprint-mismatched session) or 404 (unknown event), or the body did not
 * parse. The caller (`resolvePlayerCard`) turns `null` into the guest gate for a
 * visitor with no session and into the honest unavailability message for a
 * signed-in doctor — never into a mounted frame with nothing behind it.
 *
 * A `preparing` event answers 200 with `{primary: null, secondary: null}`, which
 * is NOT an error (design §5): it flows through as a normal value and the plaque
 * takes the card.
 *
 * Per-user and source-bearing ⇒ `cache: "no-store"`. This response must never
 * enter the shared data cache that backs the public projection — a cached source
 * is a source served to the next guest.
 */
export async function fetchEventPlayback(
  idOrSlug: string,
  session: ForwardedSession,
): Promise<EventPlayback | null> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return null;

  const res = await fetch(
    `${API_BASE}/v1/events/${encodeURIComponent(idOrSlug)}/recordings`,
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
  if (!res.ok) return null;
  try {
    return (await res.json()) as EventPlayback;
  } catch {
    // A malformed body is the same "no source to render" answer as a 401 — the
    // page degrades to the unavailability message rather than throwing on a
    // public URL.
    return null;
  }
}
