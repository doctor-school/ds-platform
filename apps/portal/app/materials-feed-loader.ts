import type { paths } from "@ds/api-client";
import { PublicFeedPageSchema, type PublicFeedPage } from "@ds/schemas";

/** Relative on purpose: the browser reads it through the portal's `/v1/*` rewrite. */
const PUBLIC_FEED_PATH = "/v1/public/feed" satisfies keyof paths;

/** 048 EARS-14 / EARS-15 / EARS-16 — one page of the Academy feed, read per visit. */
export async function loadFeedPage({
  cursor,
  limit,
}: {
  cursor: string | null;
  limit: number;
}): Promise<PublicFeedPage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) query.set("cursor", cursor);
  const res = await fetch(`${PUBLIC_FEED_PATH}?${query.toString()}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`feed read failed: ${res.status}`);
  return PublicFeedPageSchema.parse(await res.json());
}
