import { describe, expect, it } from "vitest";
import { firstOverdrawingLeg, type ResolvedLeg } from "./points-balance.js";

const PERSON = "00000000-0000-4000-8000-000000000001";
const RESERVE = "00000000-0000-4000-8000-0000000000aa";
const ISSUANCE = "00000000-0000-4000-8000-0000000000bb";

function leg(
  name: string,
  debit: string,
  credit: string,
  amount: number,
  denomination: ResolvedLeg["denomination"] = "pul",
): ResolvedLeg {
  return {
    leg: name,
    denomination,
    amount,
    debitAccountId: debit,
    creditAccountId: credit,
  };
}

describe("firstOverdrawingLeg", () => {
  it("025 EARS-22: a debit within the available Pul passes", () => {
    const balances = new Map([[PERSON, 50]]);
    expect(
      firstOverdrawingLeg(balances, [
        leg("reserve:balance", PERSON, RESERVE, 50),
      ]),
    ).toBeNull();
  });

  it("025 EARS-22: a debit that would take available Pul below zero is the offending leg", () => {
    const balances = new Map([[PERSON, 49]]);
    const over = leg("reserve:balance", PERSON, RESERVE, 50);
    expect(firstOverdrawingLeg(balances, [over])).toBe(over);
  });

  it("025 EARS-22: legs apply in order — a credit earlier in the fact funds a later debit", () => {
    const balances = new Map([[PERSON, 0]]);
    expect(
      firstOverdrawingLeg(balances, [
        leg("accrual:pul", ISSUANCE, PERSON, 10),
        leg("obligation-settle:pul", PERSON, RESERVE, 10),
      ]),
    ).toBeNull();
  });

  it("025 EARS-22: system counter-accounts and non-Pul denominations are not checked", () => {
    const balances = new Map([[PERSON, 0]]);
    expect(
      firstOverdrawingLeg(balances, [
        leg("accrual:pul", ISSUANCE, PERSON, 10),
        leg("accrual:bre", ISSUANCE, PERSON, 1, "bre"),
      ]),
    ).toBeNull();
  });
});
