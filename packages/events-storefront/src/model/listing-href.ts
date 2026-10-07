/**
 * The listing route-state href builder (004 EARS-18, wave-2 entry gate §2.2
 * row 17). Every week/month navigation of the listing is built here, on the
 * host's listing path (`routes.listing` of the host config), so the round-trip
 * stays loss-free: the reader's other query params ride along untouched.
 *
 * It carries the Academy's current params (`tab`, `view`, `month`, `cursor`,
 * `cursorTrail`, `page`). PR 2.4 / PR 2.5 replace it with the one feed codec
 * and the D1 legacy-URL redirect (gate §4.3).
 */
export type ListingQueryInput = Record<string, string | string[] | undefined>;

export interface ListingHrefChange {
  view: "week" | "month";
  /** `undefined` preserves the current value; `null` removes it. */
  month?: string | null;
  /** A tab switch changes the feed membership, so its cursor cannot survive. */
  resetFeedPage?: boolean;
  hash?: string | undefined;
}

/** One loss-free codec for every listing week/month navigation on `listingPath`. */
export function buildListingHref(
  listingPath: string,
  input: ListingQueryInput,
  change: ListingHrefChange,
): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(input)) {
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const value of values) params.append(key, value);
  }

  if (change.view === "month") params.set("view", "month");
  else params.delete("view");
  if (change.month === null) params.delete("month");
  else if (change.month !== undefined) params.set("month", change.month);

  if (change.resetFeedPage) {
    params.delete("cursor");
    params.delete("cursorTrail");
    params.delete("page");
  }

  const query = params.toString();
  const hash = change.hash ? `#${change.hash.replace(/^#/, "")}` : "";
  return `${query ? `${listingPath}?${query}` : listingPath}${hash}`;
}
