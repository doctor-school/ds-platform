import { SpecialtyFeedSchema, type SpecialtyFeed } from "@ds/schemas";
import {
  serverApiBase,
  forwardedHeaders,
  forwardedSessionFrom,
} from "@ds/auth-flow/server";

/**
 * 018 EARS-1 (#1496) — the server read of the specialty feed envelope
 * (`GET /v1/storefront/feed/{specialty}`, 018-design §7) for the feed route.
 *
 * The session rides along only so the envelope can answer `viewer.loggedIn`;
 * the block list and its order never depend on it (LD-1). A 404 is the api's
 * answer for a path naming no member of the specialty book — the route then
 * renders its not-found state. Any other failure throws to the route's error
 * boundary: without the envelope there is no specialty to head the page with.
 */
export type SpecialtyFeedRead =
  | { readonly kind: "ok"; readonly feed: SpecialtyFeed }
  | { readonly kind: "not-found" };

export async function fetchSpecialtyFeed(
  specialty: string,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<SpecialtyFeedRead> {
  const res = await fetchImpl(
    `${serverApiBase()}/v1/storefront/feed/${encodeURIComponent(specialty)}`,
    {
      headers: forwardedHeaders(forwardedSessionFrom(headers)),
      cache: "no-store",
    },
  );
  if (res.status === 404) return { kind: "not-found" };
  if (!res.ok) throw new Error(`specialty feed read failed (${res.status})`);
  return { kind: "ok", feed: SpecialtyFeedSchema.parse(await res.json()) };
}
