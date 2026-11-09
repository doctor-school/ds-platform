import { describe, expect, it } from "vitest";
import {
  type PointsAccount,
  PointsAccountSchema,
} from "./points-account.schema.js";

const personId = "6f1c1b8e-2a4d-4c41-9a51-5f7d1f0c2b10";
const account: PointsAccount = {
  personId,
  pul: { unit: "Pul", available: 30, reserved: 10 },
  bre: 2,
  con: 0,
  advance: { open: 1, remaining: 5 },
  status: "open",
};

/** Every key of a value, nested, so a field name can be swept. */
function keysOf(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

describe("025 PointsAccount read model", () => {
  it("025 EARS-30: every Pul amount is an integer and the Pul block names its unit Pul", () => {
    expect(PointsAccountSchema.parse(account)).toEqual(account);
    for (const bad of [
      { ...account, pul: { ...account.pul, available: 1.5 } },
      { ...account, pul: { ...account.pul, reserved: -1 } },
      { ...account, pul: { ...account.pul, unit: "RUB" } },
      { ...account, advance: { open: 0, remaining: 0.5 } },
    ]) {
      expect(PointsAccountSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("025 EARS-30: no field derives a free or money statement — an extra field is refused", () => {
    expect(
      PointsAccountSchema.safeParse({ ...account, isFree: true }).success,
    ).toBe(false);
    for (const key of keysOf(account)) {
      expect(key).not.toMatch(/free|money|price|rub|бесплатно|баллы/i);
    }
  });
});
