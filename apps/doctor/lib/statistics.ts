import { ScaleStatisticsSchema, type ScaleStatistics } from "@ds/schemas";

/**
 * 017 EARS-2 / LD-3 — the storefront's ONE scale-statistics read.
 *
 * `GET /v1/public/statistics` is public and identical for a guest and a
 * signed-in doctor, so this read carries no session and no fingerprint surface
 * (unlike `lib/session.ts`, whose BFF read is per-caller). The path is written
 * RELATIVE on purpose: the hero fetches it from the browser through the app's
 * own origin, which `next.config.ts` rewrites onto the api. That is what makes
 * the four `dataState` renders of 017-design §6 row 1 reachable at all — a
 * server-rendered fetch has no «загрузка» state to show and no way to fail
 * without taking the hero copy down with it, and design §6 requires both a
 * skeleton and an error render that keeps the hero copy intact.
 *
 * The response is validated against the SHARED Zod contract rather than cast:
 * the omission rule («a counter with no source is absent, never a zero») is only
 * meaningful if the consumer refuses a body that violated it. A malformed body
 * is therefore an error — the error render — not a half-drawn hero.
 *
 * `fetchImpl` is injected for tests, exactly as `fetchSessionClaims` does it;
 * production callers pass nothing.
 */
export const SCALE_STATISTICS_PATH = "/v1/public/statistics";

export async function fetchScaleStatistics(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ScaleStatistics> {
  const res = await fetchImpl(SCALE_STATISTICS_PATH, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!res.ok) throw new Error(`statistics fetch failed (${res.status})`);
  return ScaleStatisticsSchema.parse(await res.json());
}
