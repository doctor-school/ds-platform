import {
  AdjacentAreasSchema,
  SpecialtyFeedSchema,
  specialtyFeedBlockRead,
  type AdjacentAreas,
  type SpecialtyFeed,
} from "@ds/schemas";
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

/**
 * 018 EARS-8 (#1503) — the adjacent-areas block read
 * (`GET /v1/storefront/feed/{specialty}/adjacent`). A public read: no viewer
 * field rides it, so only the client address is forwarded, as the nearest-
 * events block does. Any failure is the block's own (LD-7): it answers
 * `{ ok: false }` and the block shows its error and «Повторить» while every
 * other block stays as it is.
 */
export type AdjacentAreasRead =
  | { readonly ok: true; readonly value: AdjacentAreas }
  | { readonly ok: false };

export async function fetchSpecialtyFeedAdjacent(
  specialtyCode: string,
  forwardedFor: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdjacentAreasRead> {
  try {
    const res = await fetchImpl(
      `${serverApiBase()}${specialtyFeedBlockRead(specialtyCode, "adjacent")}`,
      {
        headers: {
          accept: "application/json",
          ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return { ok: false };
    return { ok: true, value: AdjacentAreasSchema.parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}
