import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RATE_LIMIT_THRESHOLDS,
  resolveRateLimitThresholds,
  type RateLimitEnv,
  type RateLimitOverrideRejection,
} from "./rate-limit.types.js";

// #1076: the EARS-13 ceilings become env-overridable for an ops / load-test
// window (prep for the #873 phase-2 auth-burst run). The DI token's doc comment
// always claimed "env-overridable in the module"; this makes it true WITHOUT
// changing the EARS-13 defaults or semantics. The contract is fail-SAFE: unset ⇒
// the byte-identical default, a valid positive integer ⇒ overrides only that
// field, and anything malformed ⇒ the default + a loud warn — never an unlimited
// state, never a boot crash. The existing `rate-limit.service.spec.ts` EARS-13
// suite stays untouched and green, which is the byte-identical-defaults proof at
// the behaviour level; these tests pin the resolver contract directly.
describe("resolveRateLimitThresholds (EARS-13 env overrides, #1076)", () => {
  const rejections = (env: RateLimitEnv) => {
    const seen: RateLimitOverrideRejection[] = [];
    const result = resolveRateLimitThresholds(env, (r) => seen.push(r));
    return { result, seen };
  };

  it("EARS-13 (#1076): unset env resolves to the byte-identical defaults, no rejections", () => {
    const { result, seen } = rejections({});
    expect(result).toEqual(DEFAULT_RATE_LIMIT_THRESHOLDS);
    expect(seen).toEqual([]);
  });

  it("EARS-13 (#1076): the resolved object is a fresh copy — mutating it never touches the shared default", () => {
    const result = resolveRateLimitThresholds({});
    result.perUserPer15Min = 999;
    expect(DEFAULT_RATE_LIMIT_THRESHOLDS.perUserPer15Min).toBe(10);
  });

  it("EARS-13 (#1076): RATE_LIMIT_PER_USER_15MIN overrides only the per-user ceiling", () => {
    const { result, seen } = rejections({ RATE_LIMIT_PER_USER_15MIN: "50" });
    expect(result).toEqual({
      ...DEFAULT_RATE_LIMIT_THRESHOLDS,
      perUserPer15Min: 50,
    });
    expect(seen).toEqual([]);
  });

  it("EARS-13 (#1076): RATE_LIMIT_PER_IP_15MIN overrides only the per-IP ceiling", () => {
    const { result } = rejections({ RATE_LIMIT_PER_IP_15MIN: "200" });
    expect(result).toEqual({
      ...DEFAULT_RATE_LIMIT_THRESHOLDS,
      perIpPer15Min: 200,
    });
  });

  it("EARS-13 (#1076): RATE_LIMIT_PER_ASN_1H overrides only the per-ASN ceiling", () => {
    const { result } = rejections({ RATE_LIMIT_PER_ASN_1H: "1000" });
    expect(result).toEqual({
      ...DEFAULT_RATE_LIMIT_THRESHOLDS,
      perAsnPerHour: 1000,
    });
  });

  it("EARS-13 (#1076): all three vars override independently and together", () => {
    const { result, seen } = rejections({
      RATE_LIMIT_PER_USER_15MIN: "1",
      RATE_LIMIT_PER_IP_15MIN: "2",
      RATE_LIMIT_PER_ASN_1H: "3",
    });
    expect(result).toEqual({
      perUserPer15Min: 1,
      perIpPer15Min: 2,
      perAsnPerHour: 3,
    });
    expect(seen).toEqual([]);
  });

  it.each([
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["non-integer", "10.5"],
    ["numeric junk", "10abc"],
  ])(
    "EARS-13 (#1076): a %s value is rejected — the per-user default is kept and the var + value are reported once",
    (_label, bad) => {
      const { result, seen } = rejections({ RATE_LIMIT_PER_USER_15MIN: bad });
      expect(result.perUserPer15Min).toBe(
        DEFAULT_RATE_LIMIT_THRESHOLDS.perUserPer15Min,
      );
      expect(seen).toEqual([
        { envVar: "RATE_LIMIT_PER_USER_15MIN", rawValue: bad },
      ]);
    },
  );

  it("EARS-13 (#1076): empty / whitespace-only is treated as unset — default kept, NOT reported as malformed", () => {
    const { result, seen } = rejections({
      RATE_LIMIT_PER_USER_15MIN: "",
      RATE_LIMIT_PER_IP_15MIN: "   ",
    });
    expect(result).toEqual(DEFAULT_RATE_LIMIT_THRESHOLDS);
    expect(seen).toEqual([]);
  });

  it("EARS-13 (#1076): a malformed value never opens an unlimited/disabled state — every ceiling stays a positive finite integer", () => {
    const { result } = rejections({
      RATE_LIMIT_PER_USER_15MIN: "0",
      RATE_LIMIT_PER_IP_15MIN: "-1",
      RATE_LIMIT_PER_ASN_1H: "NaN",
    });
    for (const v of Object.values(result)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(result).toEqual(DEFAULT_RATE_LIMIT_THRESHOLDS);
  });

  it("EARS-13 (#1076): a valid override on one field and a malformed value on another are handled per-field", () => {
    const { result, seen } = rejections({
      RATE_LIMIT_PER_USER_15MIN: "40", // valid → applied
      RATE_LIMIT_PER_IP_15MIN: "oops", // malformed → default + reject
    });
    expect(result).toEqual({
      ...DEFAULT_RATE_LIMIT_THRESHOLDS,
      perUserPer15Min: 40,
    });
    expect(seen).toEqual([
      { envVar: "RATE_LIMIT_PER_IP_15MIN", rawValue: "oops" },
    ]);
  });

  it("EARS-13 (#1076): the default onReject is a silent no-op (a bare resolve never throws on a malformed var)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      resolveRateLimitThresholds({ RATE_LIMIT_PER_ASN_1H: "bad" }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
