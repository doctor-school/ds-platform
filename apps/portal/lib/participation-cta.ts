import type { ParticipationCta } from "@ds/schemas";

import type { ForwardedSession } from "./registration-state";

/**
 * 020 EARS-1 / LD-2 (#1764, slice 3) — the academy host's read of the ONE
 * server-resolved participation policy.
 *
 * The sibling read (`GET /v1/public/events/:idOrSlug/participation`) is public
 * with an OPTIONAL principal: it answers for a guest and for a signed-in doctor
 * alike, which is precisely why the host can stop resolving anything. The 004
 * `resolvePrimaryCta` + `buildRegistrationHref` pair this replaces is DELETED,
 * not left alongside: two resolvers for one decision is the divergence 020
 * exists to end (design §1.1 — «no second CTA resolver»), and the api already
 * builds the same `/register?returnTo=/webinars/:slug` handoff from its own
 * route table.
 *
 * The session is forwarded exactly as the 005 registration-state read forwards
 * it (cookie + the fingerprint-bound surface headers, ADR-0001 §6), because the
 * answer for a REGISTERED doctor differs from the guest's. The response is
 * `Cache-Control: private, no-store` upstream and read `no-store` here — a
 * per-viewer answer must never land in a shared cache.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Fetch the participation CTA for `idOrSlug`, or `null` when the event is not
 * publicly reachable. A guest (no cookie) issues the SAME read — the endpoint is
 * `@Public()` with an optional principal, so there is no host-side branch on
 * whether a session exists.
 */
export async function fetchParticipationCta(
  idOrSlug: string,
  session: ForwardedSession,
): Promise<ParticipationCta | null> {
  const res = await fetch(
    `${API_BASE}/v1/public/events/${encodeURIComponent(idOrSlug)}/participation`,
    {
      headers: {
        accept: "application/json",
        ...(session.cookie
          ? {
              cookie: session.cookie,
              "user-agent": session.userAgent,
              "accept-language": session.acceptLanguage,
            }
          : {}),
      },
      cache: "no-store",
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`participation cta fetch failed (${res.status})`);
  }
  return (await res.json()) as ParticipationCta;
}
