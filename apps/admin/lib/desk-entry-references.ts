import { SpecialtySearchResultSchema, type SpecialtyRef } from "@ds/schemas";

/**
 * 044 EARS-35 — the reference books behind the desk entry's selectors.
 *
 * The specialty selector searches the closed book SERVER-side through the same
 * public read the doctor storefront and the congress site use
 * (`GET /v1/public/specialties/search?q=`, 017-design §7): a registrar holds no
 * grant on the admin specialty list, and the book is public anyway. A missing
 * `q` is that read's Open state — the whole book — so the selector's first,
 * empty search is the whole book the form offered before any typing.
 */
const SPECIALTY_SEARCH_PATH = "/v1/public/specialties/search";

export function specialtySearchUrl(q: string): string {
  const needle = q.trim();
  return needle
    ? `${SPECIALTY_SEARCH_PATH}?q=${encodeURIComponent(needle)}`
    : SPECIALTY_SEARCH_PATH;
}

/**
 * One search answer as a `useServerCombobox` page. The read is not paged: its
 * answer is the whole narrowed book, so the page's total is what it carries and
 * the selector never offers a «load more» the read could not serve.
 */
export async function fetchSpecialtySearchPage(
  { q }: { q: string },
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ data: SpecialtyRef[]; total: number; page: number }> {
  const res = await fetchImpl(specialtySearchUrl(q), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`specialty search: HTTP ${res.status}`);
  const answer = SpecialtySearchResultSchema.parse(await res.json());
  return { data: answer.entries, total: answer.entries.length, page: 1 };
}
