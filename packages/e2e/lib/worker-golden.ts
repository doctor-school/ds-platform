import { test } from "@playwright/test";

import { resolveGoldenDoctor, type GoldenDoctor } from "./golden.js";

/**
 * #2805 — the golden doctor THIS Playwright worker signs in as.
 *
 * The suite runs on parallel workers (`playwright.config.ts`), and each worker
 * owns one account of the golden worker pool, picked by `parallelIndex` — the
 * 0..workers-1 slot a worker keeps for its whole life, reused by its replacement
 * after a failure. Every step and walk that names a golden doctor resolves it
 * here, never through a bare `resolveGoldenDoctor(seed)`, so two workers can
 * never sign in as, log out of, or arm a reset on the same account.
 *
 * Callable only inside a running test (`test.info()` throws elsewhere) — the
 * pure resolver stays in `golden.ts` for unit tests.
 */
export function resolveWorkerGoldenDoctor(seedName: string): GoldenDoctor {
  return resolveGoldenDoctor(seedName, test.info().parallelIndex);
}
