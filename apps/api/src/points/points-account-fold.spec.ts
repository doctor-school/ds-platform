import { describe, expect, it } from "vitest";
import { foldPointsAccount, type FoldPosting } from "./points-balance.js";

const me = "acc-person";
const other = "acc-other";
const issuance = "acc-issuance";
const reserve = "acc-reserve";
const advance = "acc-advance";
const sink = "acc-sink";
const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h));

function p(
  eventId: string,
  leg: string,
  debitAccountId: string,
  creditAccountId: string,
  amount: number,
  denomination: FoldPosting["denomination"] = "pul",
  occurredAt = at(10),
): FoldPosting {
  return {
    eventId,
    leg,
    debitAccountId,
    creditAccountId,
    denomination,
    amount,
    occurredAt,
  };
}

describe("025 PointsAccount fold", () => {
  it("025 EARS-2: an account with no postings folds to zero in every denomination", () => {
    expect(foldPointsAccount(me, [])).toEqual({
      pul: { available: 0, reserved: 0 },
      bre: 0,
      con: 0,
      advance: { open: 0, remaining: 0 },
    });
  });

  it("025 EARS-2: available is Σ credits − Σ debits per denomination of the person account only", () => {
    const fold = foldPointsAccount(me, [
      p("e1", "accrual:pul", issuance, me, 40),
      p("e1", "accrual:bre", issuance, me, 3, "bre"),
      p("e2", "accrual:con", issuance, me, 2, "con"),
      p("e3", "accrual:pul", issuance, other, 99),
      p("reserve:r1", "reserve:balance", me, reserve, 15),
    ]);
    expect(fold.pul.available).toBe(25);
    expect(fold.bre).toBe(3);
    expect(fold.con).toBe(2);
  });

  it("025 EARS-2: reserved is the person's own Pul held by reserves not yet settled or released", () => {
    const fold = foldPointsAccount(me, [
      p("e1", "accrual:pul", issuance, me, 100),
      p("reserve:r1", "reserve:balance", me, reserve, 10),
      p("reserve:r2", "reserve:balance", me, reserve, 20),
      p("settle:r2", "settle:pul", reserve, sink, 20),
      p("reserve:r3", "reserve:balance", me, reserve, 30),
      p("release:r3", "release:balance", reserve, me, 30),
    ]);
    expect(fold.pul).toEqual({ available: 70, reserved: 10 });
  });

  it("025 EARS-2: an advance opened by a reserve stays open until later Pul nets it; a released reserve opens none", () => {
    const fold = foldPointsAccount(me, [
      p("e1", "accrual:pul", issuance, me, 5, "pul", at(8)),
      p("reserve:r1", "reserve:balance", me, reserve, 5, "pul", at(9)),
      p("reserve:r1", "reserve:advance", advance, reserve, 15, "pul", at(9)),
      p("reserve:r2", "reserve:balance", me, reserve, 1, "pul", at(10)),
      p("reserve:r2", "reserve:advance", advance, reserve, 4, "pul", at(10)),
      p("release:r2", "release:balance", reserve, me, 1, "pul", at(11)),
      p("release:r2", "release:advance", reserve, advance, 4, "pul", at(11)),
      p("e2", "accrual:pul", issuance, me, 6, "pul", at(12)),
      p("e2", "obligation-settle:pul", me, advance, 6, "pul", at(12)),
    ]);
    expect(fold.advance).toEqual({ open: 1, remaining: 9 });
    expect(fold.pul).toEqual({ available: 0, reserved: 5 });
  });

  it("025 EARS-2: an obligation fully netted is no longer open (oldest first)", () => {
    const fold = foldPointsAccount(me, [
      p("e0", "accrual:pul", issuance, me, 2, "pul", at(7)),
      p("reserve:r1", "reserve:balance", me, reserve, 1, "pul", at(8)),
      p("reserve:r1", "reserve:advance", advance, reserve, 3, "pul", at(8)),
      p("reserve:r2", "reserve:balance", me, reserve, 1, "pul", at(9)),
      p("reserve:r2", "reserve:advance", advance, reserve, 4, "pul", at(9)),
      p("e1", "accrual:pul", issuance, me, 3, "pul", at(10)),
      p("e1", "obligation-settle:pul", me, advance, 3, "pul", at(10)),
    ]);
    expect(fold.advance).toEqual({ open: 1, remaining: 4 });
  });
});
