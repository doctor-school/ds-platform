import { describe, expect, it } from "vitest";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";

const passed = (title: string) => ({
  title,
  tests: [{ status: "expected", results: [{ status: "passed", retry: 0 }] }],
});
const report = (specs: unknown[]) => ({
  suites: [{ suites: [{ specs }] }],
  errors: [],
});
describe("operational original receipt gate", () => {
  it("accepts the exact three material originals and refuses an incidental fourth", () => {
    const originals = operationalOriginals.materials;
    expect(originals).toEqual([
      "A column without an expert is refused",
      "A stale edit is refused",
      "The administrator finds materials by kind",
    ]);
    expect(() =>
      assertOperationalReport(report(originals.map(passed)), originals),
    ).not.toThrow();
    expect(() =>
      assertOperationalReport(
        report([
          ...originals.map(passed),
          passed(
            "An administrator writes a news item and it becomes the first card of the rail",
          ),
        ]),
        originals,
      ),
    ).toThrow("identity mismatch");
  });
  it("accepts each expected original exactly once on its first attempt", () => {
    expect(() =>
      assertOperationalReport(
        report([passed("first"), passed("second @host:academy")]),
        ["first", "second"],
      ),
    ).not.toThrow();
  });
  it("rejects a missing report, empty selection, wrong title, duplicate and omitted original", () => {
    for (const value of [
      undefined,
      {},
      report([]),
      report([passed("other"), passed("second")]),
      report([passed("first"), passed("first")]),
      report([passed("first")]),
    ])
      expect(() =>
        assertOperationalReport(value, ["first", "second"]),
      ).toThrow();
  });
  it("rejects skip, flake, retry, extra attempts and top-level failures", () => {
    for (const test of [
      { status: "skipped", results: [{ status: "skipped", retry: 0 }] },
      { status: "flaky", results: [{ status: "passed", retry: 0 }] },
      { status: "expected", results: [{ status: "passed", retry: 1 }] },
      {
        status: "expected",
        results: [
          { status: "failed", retry: 0 },
          { status: "passed", retry: 1 },
        ],
      },
    ])
      expect(() =>
        assertOperationalReport(report([{ title: "first", tests: [test] }]), [
          "first",
        ]),
      ).toThrow();
    expect(() =>
      assertOperationalReport(
        { ...report([passed("first")]), errors: [{ message: "worker died" }] },
        ["first"],
      ),
    ).toThrow();
  });
});
