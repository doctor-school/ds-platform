import { describe, expect, it } from "vitest";
import { POINTS_LEDGER_ERROR_CODES } from "@ds/schemas";
import { PointsLedgerError } from "./points.errors.js";

describe("PointsLedgerError", () => {
  it("025 EARS-31: a closed account refuses with problem points-account-closed", () => {
    const error = new PointsLedgerError("POINTS_ACCOUNT_CLOSED");
    const body = error.toProblemDetails("trace-1");
    expect(error.problem).toBe("points-account-closed");
    expect(body.type.endsWith("/points-account-closed")).toBe(true);
    expect(body.status).toBe(409);
    expect(body.errorCode).toBe("POINTS_ACCOUNT_CLOSED");
    expect(body.traceId).toBe("trace-1");
  });

  it("025 EARS-22: an overdraw refuses with problem points-insufficient-pul", () => {
    const body = new PointsLedgerError(
      "POINTS_INSUFFICIENT_PUL",
    ).toProblemDetails("t");
    expect(body.type.endsWith("/points-insufficient-pul")).toBe(true);
    expect(body.status).toBe(409);
  });

  it("025 EARS-27: a far-future fact refuses with problem points-occurred-at-future", () => {
    const body = new PointsLedgerError(
      "POINTS_OCCURRED_AT_FUTURE",
    ).toProblemDetails("t");
    expect(body.type.endsWith("/points-occurred-at-future")).toBe(true);
    expect(body.status).toBe(422);
  });
});

describe("PointsLedgerError — rule book", () => {
  it("025 EARS-12: a Bre/Con debit refuses with problem points-bre-con-debit (422)", () => {
    const body = new PointsLedgerError("POINTS_BRE_CON_DEBIT").toProblemDetails(
      "t",
    );
    expect(body.type.endsWith("/points-bre-con-debit")).toBe(true);
    expect(body.status).toBe(422);
  });

  it("025 EARS-25: publish refusals are 404 unknown rule and 422 invalid parameters with field errors", () => {
    expect(new PointsLedgerError("POINTS_RULE_UNKNOWN").getStatus()).toBe(404);
    const body = new PointsLedgerError(
      "POINTS_RULE_PARAMETERS_INVALID",
      undefined,
      [{ path: "pul", message: "Too small" }],
    ).toProblemDetails("t");
    expect(body.status).toBe(422);
    expect(body.errors).toEqual([{ path: "pul", message: "Too small" }]);
    expect(
      new PointsLedgerError("POINTS_RULE_EFFECTIVE_FROM_PAST").getStatus(),
    ).toBe(422);
  });

  it("025 EARS-30: no points-* problem detail calls a Pul price «бесплатно», points «баллы» or anything free", () => {
    for (const code of POINTS_LEDGER_ERROR_CODES) {
      const body = new PointsLedgerError(code, "detail").toProblemDetails(
        "trace",
        "/v1/x",
      );
      expect(JSON.stringify(body), code).not.toMatch(
        /бесплатн|балл|\bfree\b|money/i,
      );
    }
  });
});
