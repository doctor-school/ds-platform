import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  resolveSmsBudgetThresholds,
  type SmsBudgetEnv,
  type SmsBudgetOverrideRejection,
} from "./sms-budget.types.js";

// #3047: the four EARS-14 ceilings become env-overridable for a test stand that
// plays the whole suite from ONE runner address (the stage slots), mirroring the
// EARS-13 `RATE_LIMIT_*` contract (#1076). The EARS-14 defaults and semantics do
// not change: unset ⇒ the byte-identical defaults, a valid positive integer ⇒
// overrides only that field, anything malformed ⇒ the default + a loud warn —
// never an unlimited state, never a boot crash. `sms-budget.service.spec.ts`
// stays untouched and green (the behaviour-level defaults proof); these tests
// pin the resolver contract directly.
describe("resolveSmsBudgetThresholds (EARS-14 env overrides, #3047)", () => {
  const resolve = (env: SmsBudgetEnv) => {
    const seen: SmsBudgetOverrideRejection[] = [];
    const result = resolveSmsBudgetThresholds(env, (r) => seen.push(r));
    return { result, seen };
  };

  it("EARS-14 (#3047): unset env resolves to the byte-identical defaults, no rejections", () => {
    const { result, seen } = resolve({});
    expect(result).toEqual(DEFAULT_SMS_BUDGET_THRESHOLDS);
    expect(result).toEqual({
      perPhonePerHour: 3,
      perIpPerHour: 10,
      perAsnPerHour: 100,
      globalPerDay: 2000,
    });
    expect(seen).toEqual([]);
  });

  it("EARS-14 (#3047): the resolved object is a fresh copy — mutating it never touches the shared default", () => {
    const result = resolveSmsBudgetThresholds({});
    result.perIpPerHour = 999;
    expect(DEFAULT_SMS_BUDGET_THRESHOLDS.perIpPerHour).toBe(10);
  });

  it.each([
    ["SMS_BUDGET_PER_PHONE_1H", "perPhonePerHour"],
    ["SMS_BUDGET_PER_IP_1H", "perIpPerHour"],
    ["SMS_BUDGET_PER_ASN_1H", "perAsnPerHour"],
    ["SMS_BUDGET_GLOBAL_1D", "globalPerDay"],
  ] as const)("EARS-14 (#3047): %s overrides only %s", (envVar, field) => {
    const { result, seen } = resolve({ [envVar]: "500" });
    expect(result).toEqual({ ...DEFAULT_SMS_BUDGET_THRESHOLDS, [field]: 500 });
    expect(seen).toEqual([]);
  });

  it.each([
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["non-integer", "10.5"],
    ["numeric junk", "10abc"],
  ])(
    "EARS-14 (#3047): a %s value is rejected — the per-IP default is kept and the var + value are reported once",
    (_label, bad) => {
      const { result, seen } = resolve({ SMS_BUDGET_PER_IP_1H: bad });
      expect(result).toEqual(DEFAULT_SMS_BUDGET_THRESHOLDS);
      expect(seen).toEqual([{ envVar: "SMS_BUDGET_PER_IP_1H", rawValue: bad }]);
    },
  );

  it("EARS-14 (#3047): empty / whitespace-only is treated as unset — default kept, NOT reported as malformed", () => {
    const { result, seen } = resolve({
      SMS_BUDGET_PER_IP_1H: "",
      SMS_BUDGET_GLOBAL_1D: "   ",
    });
    expect(result).toEqual(DEFAULT_SMS_BUDGET_THRESHOLDS);
    expect(seen).toEqual([]);
  });

  it("EARS-14 (#3047): a malformed value never opens an unlimited/disabled state — every ceiling stays a positive finite integer", () => {
    const { result } = resolve({
      SMS_BUDGET_PER_PHONE_1H: "0",
      SMS_BUDGET_PER_IP_1H: "-1",
      SMS_BUDGET_PER_ASN_1H: "NaN",
      SMS_BUDGET_GLOBAL_1D: "Infinity",
    });
    for (const v of Object.values(result)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(result).toEqual(DEFAULT_SMS_BUDGET_THRESHOLDS);
  });

  it("EARS-14 (#3047): a valid override on one field and a malformed value on another are handled per-field", () => {
    const { result, seen } = resolve({
      SMS_BUDGET_PER_IP_1H: "100000",
      SMS_BUDGET_PER_ASN_1H: "oops",
    });
    expect(result).toEqual({
      ...DEFAULT_SMS_BUDGET_THRESHOLDS,
      perIpPerHour: 100000,
    });
    expect(seen).toEqual([
      { envVar: "SMS_BUDGET_PER_ASN_1H", rawValue: "oops" },
    ]);
  });
});
