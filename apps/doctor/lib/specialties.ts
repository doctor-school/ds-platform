import {
  FrequentSpecialtiesSchema,
  SpecialtyBookSchema,
  SpecialtySearchResultSchema,
  type FrequentSpecialties,
  type SpecialtyBook,
  type SpecialtySearchResult,
} from "@ds/schemas";

/**
 * 017 EARS-4 / EARS-5 — the storefront's reads behind the specialty catalog
 * (017-design §7 rows «specialty book», «frequent specialties», «specialty
 * search»).
 *
 * Written RELATIVE, and fetched from the browser, for the same reason
 * `lib/statistics.ts` is: `next.config.ts` rewrites the path onto the api, and
 * the §3 catalog state machine has a Loading state and an error render that a
 * server-rendered fetch could neither show nor fail into without taking the rest
 * of the home page down with it (EARS-4 requires the page to stay readable).
 *
 * Every response is validated against the SHARED Zod contract rather than cast.
 * That is what makes «no surface hardcodes a count» enforceable at the edge:
 * `SpecialtyBook.total` is the ONE source for the «Показать весь список — N»
 * control, and a body that omitted or contradicted it is an error state, not a
 * catalog rendered with a made-up number.
 *
 * `fetchImpl` is injected for tests, exactly as `fetchScaleStatistics` does it;
 * production callers pass nothing.
 */
export const SPECIALTY_BOOK_PATH = "/v1/public/specialties";
export const SPECIALTY_FREQUENT_PATH = "/v1/public/specialties/frequent";
export const SPECIALTY_SEARCH_PATH = "/v1/public/specialties/search";

async function readJson(
  path: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetchImpl(path, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`specialties fetch failed (${res.status})`);
  return res.json();
}

export async function fetchSpecialtyBook(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SpecialtyBook> {
  return SpecialtyBookSchema.parse(
    await readJson(SPECIALTY_BOOK_PATH, fetchImpl, signal),
  );
}

export async function fetchFrequentSpecialties(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<FrequentSpecialties> {
  return FrequentSpecialtiesSchema.parse(
    await readJson(SPECIALTY_FREQUENT_PATH, fetchImpl, signal),
  );
}

/**
 * The search read (EARS-5). The narrowing happens on the SERVER, over the whole
 * book, by the rule `@ds/schemas` owns — the storefront does not keep a second
 * copy of a legal reference book in order to filter it, and cannot narrow by a
 * rule that has drifted from the one the platform enforces.
 */
export async function searchSpecialties(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SpecialtySearchResult> {
  const path = `${SPECIALTY_SEARCH_PATH}?q=${encodeURIComponent(query)}`;
  return SpecialtySearchResultSchema.parse(
    await readJson(path, fetchImpl, signal),
  );
}
