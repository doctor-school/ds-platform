import { describe, expect, it } from "vitest";
import {
  assertPointsEngineReport,
  assertPointsRecordBoundariesReport,
} from "./points-engine-report.js";

const previous = [
  "An offline lesson earns Bre only and never a second Bre",
  "A producer fact carrying an amount is refused and writes nothing",
  "A fact no rule applies to is journaled with no effect",
];
const boundaries = [
  "The same lesson reported from two storefronts and an offline sync accrues once",
  "A closed account accepts no posting",
  "A completed module accrues all three units once",
];

function report(titles: readonly string[]) {
  return {
    errors: [],
    suites: [
      {
        specs: titles.map((title) => ({
          title,
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

for (const [scope, titles, assertReport] of [
  ["full contour", [...previous, ...boundaries], assertPointsEngineReport],
  ["new wave", boundaries, assertPointsRecordBoundariesReport],
] as const) {
  describe("025 " + scope + " execution receipt", () => {
    it("EARS-4/8/31: accepts its exact source originals passing once", () => {
      expect(() => assertReport(report(titles))).not.toThrow();
    });
    it("EARS-4/8/31: refuses a different original at the same count", () => {
      const value = report(titles);
      value.suites[0]!.specs[0]!.title = "Another scenario";
      expect(() => assertReport(value)).toThrow(/identity/);
    });
    it.each(["skipped", "failed", "timedOut"])(
      "EARS-4/8/31: refuses %s",
      (status) => {
        const value = report(titles);
        value.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
        expect(() => assertReport(value)).toThrow();
      },
    );
    it("EARS-4/8/31: refuses a passing retry", () => {
      const value = report(titles);
      value.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
      expect(() => assertReport(value)).toThrow();
    });
    it("EARS-4/8/31: refuses missing, extra and duplicate identities", () => {
      const missing = report(titles);
      missing.suites[0]!.specs.pop();
      expect(() => assertReport(missing)).toThrow(/identity/);
      const extra = report(titles);
      extra.suites[0]!.specs.push(extra.suites[0]!.specs[0]!);
      expect(() => assertReport(extra)).toThrow(/identity/);
      const duplicate = report(titles);
      duplicate.suites[0]!.specs[1]!.title =
        duplicate.suites[0]!.specs[0]!.title;
      expect(() => assertReport(duplicate)).toThrow(/identity/);
    });
    it("EARS-4/8/31: refuses flaky status and multiple attempts", () => {
      const flaky = report(titles);
      flaky.suites[0]!.specs[0]!.tests[0]!.status = "flaky";
      expect(() => assertReport(flaky)).toThrow();
      const repeated = report(titles);
      repeated.suites[0]!.specs[0]!.tests[0]!.results.push({
        status: "passed",
        retry: 0,
      });
      expect(() => assertReport(repeated)).toThrow();
    });
    it("EARS-4/8/31: refuses another host and report-level errors", () => {
      const value = report(titles);
      value.suites[0]!.specs[0]!.tests[0]!.projectId = "academy";
      expect(() => assertReport(value)).toThrow();
      expect(() => assertReport({ ...report(titles), errors: [{}] })).toThrow();
    });
  });
}

it("EARS-4/8/31: the new-wave receipt cannot accept the preceding three", () => {
  expect(() => assertPointsRecordBoundariesReport(report(previous))).toThrow(
    /identity/,
  );
});
