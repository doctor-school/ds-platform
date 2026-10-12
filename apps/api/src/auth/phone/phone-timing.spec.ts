import { afterEach, describe, expect, it } from "vitest";
import {
  PHONE_CODE_REQUEST_DEFAULT_TIMING_FLOOR_MS,
  readPhoneCodeRequestTimingFloorMs,
  resolvePhoneCodeRequestTimingFloorMs,
} from "./phone-timing.js";

// 003 EARS-51 (#2449): the code request is floored above its IdP-bound branch
// through the EARS-16 `@TimingEqualized` mechanism, with the floor read per
// request from configuration — the 044 EARS-7 precedent for a door whose
// branches run past the 40 ms auth-door default.
describe("003 EARS-51 phone code request timing floor", () => {
  const saved = process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"];
  afterEach(() => {
    if (saved === undefined) {
      delete process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"];
    } else process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"] = saved;
  });

  it("EARS-51: an unset floor is the conservative one-second default", () => {
    expect(PHONE_CODE_REQUEST_DEFAULT_TIMING_FLOOR_MS).toBe(1000);
    expect(resolvePhoneCodeRequestTimingFloorMs(undefined)).toBe(1000);
    expect(resolvePhoneCodeRequestTimingFloorMs("")).toBe(1000);
  });

  it("EARS-51: a configured whole-millisecond floor is used as written", () => {
    expect(resolvePhoneCodeRequestTimingFloorMs("2500")).toBe(2500);
  });

  it("EARS-51: a malformed floor falls back to the default — never faster", () => {
    for (const bad of ["1s", "-5", "1.5", "abc"]) {
      expect(resolvePhoneCodeRequestTimingFloorMs(bad)).toBe(1000);
    }
  });

  it("EARS-51: the floor is read per request from the environment", () => {
    process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"] = "1500";
    expect(readPhoneCodeRequestTimingFloorMs()).toBe(1500);
    delete process.env["PHONE_CODE_REQUEST_TIMING_FLOOR_MS"];
    expect(readPhoneCodeRequestTimingFloorMs()).toBe(1000);
  });
});
