import { describe, expect, it } from "vitest";
import {
  assertPointsEngineReport,
  pointsEngineOriginals,
} from "./points-engine-report.js";

function report() {
  return {
    errors: [],
    suites: [
      {
        specs: pointsEngineOriginals.map((title) => ({
          title: String(title),
          tests: [
            {
              projectName: "admin",
              projectId: "admin",
              status: "expected",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  };
}

describe("025 original execution receipt", () => {
  it("EARS-33: accepts only the exact three originals passing once", () => {
    expect(() => assertPointsEngineReport(report())).not.toThrow();
  });
  it("EARS-33: rejects a different third original even at the same count", () => {
    const value = report();
    value.suites[0]!.specs[2]!.title = "Another scenario";
    expect(() => assertPointsEngineReport(value)).toThrow(/identity/);
  });
  it.each(["skipped", "failed", "timedOut"])(
    "EARS-33: rejects %s",
    (status) => {
      const value = report();
      value.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
      expect(() => assertPointsEngineReport(value)).toThrow();
    },
  );
  it("EARS-33: rejects a passing retry", () => {
    const value = report();
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    expect(() => assertPointsEngineReport(value)).toThrow();
  });
  it("EARS-33: rejects a missing or extra original", () => {
    const missing = report();
    missing.suites[0]!.specs.pop();
    expect(() => assertPointsEngineReport(missing)).toThrow(/identity/);
    const extra = report();
    extra.suites[0]!.specs.push(extra.suites[0]!.specs[0]!);
    expect(() => assertPointsEngineReport(extra)).toThrow(/identity/);
  });
  it("EARS-33: rejects flaky status and multiple attempts", () => {
    const flaky = report();
    flaky.suites[0]!.specs[0]!.tests[0]!.status = "flaky";
    expect(() => assertPointsEngineReport(flaky)).toThrow();
    const repeated = report();
    repeated.suites[0]!.specs[0]!.tests[0]!.results.push({
      status: "passed",
      retry: 0,
    });
    expect(() => assertPointsEngineReport(repeated)).toThrow();
  });
  it("EARS-33: rejects another host and report-level errors", () => {
    const value = report();
    value.suites[0]!.specs[0]!.tests[0]!.projectId = "academy";
    expect(() => assertPointsEngineReport(value)).toThrow();
    expect(() =>
      assertPointsEngineReport({ ...report(), errors: [{}] }),
    ).toThrow();
  });
});
