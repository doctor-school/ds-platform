import { DEFAULT_TIMING_FLOOR_MS } from "./timing/timing-equalization.types.js";

export const AUTH_VERIFY_DEFAULT_TIMING_FLOOR_MS = 1000;
const MAX_TIMER_MS = 2_147_483_647;

/** 003 EARS-41/16: this IdP-bound route needs more than the global 40 ms floor. */
export function resolveAuthVerifyTimingFloorMs(
  raw: string | undefined,
): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return AUTH_VERIFY_DEFAULT_TIMING_FLOOR_MS;
  }
  const floorMs = Number(raw);
  return Number.isSafeInteger(floorMs) &&
    floorMs >= DEFAULT_TIMING_FLOOR_MS &&
    floorMs <= MAX_TIMER_MS
    ? floorMs
    : AUTH_VERIFY_DEFAULT_TIMING_FLOOR_MS;
}

/** Read on each request, as the existing phone and congress route readers do. */
export function readAuthVerifyTimingFloorMs(): number {
  return resolveAuthVerifyTimingFloorMs(
    process.env["AUTH_VERIFY_TIMING_FLOOR_MS"],
  );
}
