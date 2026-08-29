export type WebinarsQueryInput = Record<string, string | string[] | undefined>;

export interface WebinarsHrefChange {
  view: "week" | "month";
  /** `undefined` preserves the current value; `null` removes it. */
  month?: string | null;
  /** A tab switch changes the feed membership, so its cursor cannot survive. */
  resetFeedPage?: boolean;
  hash?: string;
}

/** One loss-free codec for every `/webinars` week/month navigation. */
export function buildWebinarsHref(
  input: WebinarsQueryInput,
  change: WebinarsHrefChange,
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
  return `${query ? `/webinars?${query}` : "/webinars"}${hash}`;
}
