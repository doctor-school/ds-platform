import { describe, expect, it } from "vitest";
import { foldPointsAccount, type FoldPosting } from "./points-balance.js";

const me = "acc-person";
const other = "acc-other";
const issuance = "acc-issuance";
const reserve = "acc-reserve";

function p(
  _eventId: string,
  _leg: string,
  debitAccountId: string,
  creditAccountId: string,
  amount: number,
  denomination: FoldPosting["denomination"] = "pul",
): FoldPosting {
  return { debitAccountId, creditAccountId, denomination, amount };
}

describe("025 PointsAccount fold", () => {
  it("025 EARS-2: an account with no postings folds to zero in every denomination", () => {
    expect(foldPointsAccount(me, [])).toEqual({ pul: 0, bre: 0, con: 0 });
  });

  it("025 EARS-2: available is Σ credits − Σ debits per denomination of the person account only", () => {
    const fold = foldPointsAccount(me, [
      p("e1", "accrual:pul", issuance, me, 40),
      p("e1", "accrual:bre", issuance, me, 3, "bre"),
      p("e2", "accrual:con", issuance, me, 2, "con"),
      p("e3", "accrual:pul", issuance, other, 99),
      p("r1#spend.reserve", "reserve:balance", me, reserve, 15),
    ]);
    expect(fold).toEqual({ pul: 25, bre: 3, con: 2 });
  });

  it("025 EARS-2: a released reserve returns its Pul to available", () => {
    const fold = foldPointsAccount(me, [
      p("e1", "accrual:pul", issuance, me, 100),
      p("r1#spend.reserve", "reserve:balance", me, reserve, 30),
      p("c1#spend.release", "reverse:x", reserve, me, 30),
    ]);
    expect(fold.pul).toBe(100);
  });
});
