import { describe, expect, it } from "vitest";
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
