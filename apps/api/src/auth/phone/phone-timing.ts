/**
 * 003 EARS-51 (#2449): the timing floor of `POST /v1/me/phone`.
 *
 * The request answers a number confirmed on another account exactly like a
 * free one, but the two branches do different IdP work (a free number is
 * written to the IdP with an SMS; a taken one only drops the requester's own
 * phone). The EARS-16 `@TimingEqualized` mechanism pads both to one floor; the
 * 40 ms auth-door default sits far below either branch and would pad neither,
 * so this door names its own floor — the 044 EARS-7 precedent
 * (`CONGRESS_SIGNUP_TIMING_FLOOR_MS`): configuration read per request, with a
 * conservative one-second default an operator calibrates to the IdP-bound
 * branch's p99 without a release.
 */
export const PHONE_CODE_REQUEST_DEFAULT_TIMING_FLOOR_MS = 1000;

/**
 * Resolve a configured floor. Unset or empty ⇒ the default; a value that is
 * not whole milliseconds also falls back to the default — the SAFE direction
 * (too slow, never too fast), since this door has no settings refusal through
 * which a broken value could otherwise surface.
 */
export function resolvePhoneCodeRequestTimingFloorMs(
  raw: string | undefined,
): number {
  if (raw == null || !/^\d+$/.test(raw)) {
    return PHONE_CODE_REQUEST_DEFAULT_TIMING_FLOOR_MS;
  }
  const floorMs = Number(raw);
  return Number.isSafeInteger(floorMs)
    ? floorMs
    : PHONE_CODE_REQUEST_DEFAULT_TIMING_FLOOR_MS;
}

/** The `@TimingEqualized` reader: the floor, read per request. */
export function readPhoneCodeRequestTimingFloorMs(): number {
  return resolvePhoneCodeRequestTimingFloorMs(
    process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"],
  );
}
