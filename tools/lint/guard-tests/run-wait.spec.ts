import { describe, expect, it } from "vitest";

import {
  classifyRun,
  nextAction,
  parseRunId,
} from "../../gh/run-wait.mjs";

/**
 * run-wait — unit cover for `tools/gh/run-wait.mjs`'s pure seams (#984).
 *
 * The gate is the bounded foreground poller for a single GitHub Actions run
 * (`pnpm run:wait <run-id>`): it parses `gh run view <id> --json
 * status,conclusion`, classifies from the STRUCTURED fields only, and emits one
 * terminal SUCCESS/FAIL/TIMEOUT line. The impure half (gh spawn, polling loop)
 * is exercised live; the classifier + timeout-decision seams are unit-tested
 * here on the established guard-test harness, mirroring merge-gate.spec.ts.
 */
describe("run-wait classifyRun() (#984)", () => {
  it("is pending while the run is queued or in_progress", () => {
    expect(classifyRun({ status: "queued", conclusion: null }).state).toBe(
      "pending",
    );
    expect(classifyRun({ status: "in_progress", conclusion: null }).state).toBe(
      "pending",
    );
  });

  it("is SUCCESS only on completed + success", () => {
    expect(
      classifyRun({ status: "completed", conclusion: "success" }).state,
    ).toBe("success");
  });

  it("is FAIL on any non-success terminal conclusion", () => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "neutral",
      "skipped",
      "stale",
    ]) {
      const verdict = classifyRun({ status: "completed", conclusion });
      expect(verdict.state).toBe("fail");
      expect(verdict.conclusion).toBe(conclusion);
    }
  });

  it("treats an anomalous completed run with a null conclusion as FAIL (non-success)", () => {
    expect(
      classifyRun({ status: "completed", conclusion: null }).state,
    ).toBe("fail");
  });

  it("never reads a name/status string it does not recognise as SUCCESS (structured fields only)", () => {
    // a run whose status is some unexpected string is pending, never success.
    expect(classifyRun({ status: "waiting", conclusion: null }).state).toBe(
      "pending",
    );
  });

  it("classifies a malformed / empty payload as pending (non-success), never a premature SUCCESS", () => {
    expect(classifyRun({}).state).toBe("pending");
    expect(classifyRun(null).state).toBe("pending");
    expect(classifyRun(undefined).state).toBe("pending");
    expect(classifyRun({ status: 42, conclusion: 7 }).state).toBe("pending");
    for (const bad of [{}, null, undefined]) {
      expect(classifyRun(bad).state).not.toBe("success");
    }
  });
});

describe("run-wait nextAction() (#984)", () => {
  it("resolves a terminal run immediately regardless of elapsed time", () => {
    expect(
      nextAction({ state: "success", elapsedMs: 0, timeoutMs: 900_000 }),
    ).toBe("success");
    expect(
      nextAction({ state: "fail", elapsedMs: 0, timeoutMs: 900_000 }),
    ).toBe("fail");
  });

  it("keeps polling a pending run before the deadline", () => {
    expect(
      nextAction({ state: "pending", elapsedMs: 10_000, timeoutMs: 900_000 }),
    ).toBe("poll");
  });

  it("times out a still-pending run at/after the deadline", () => {
    expect(
      nextAction({ state: "pending", elapsedMs: 900_000, timeoutMs: 900_000 }),
    ).toBe("timeout");
    expect(
      nextAction({ state: "pending", elapsedMs: 901_000, timeoutMs: 900_000 }),
    ).toBe("timeout");
  });

  it("a terminal SUCCESS/FAIL wins over an elapsed deadline (never reported as TIMEOUT)", () => {
    expect(
      nextAction({ state: "success", elapsedMs: 999_999, timeoutMs: 900_000 }),
    ).toBe("success");
    expect(
      nextAction({ state: "fail", elapsedMs: 999_999, timeoutMs: 900_000 }),
    ).toBe("fail");
  });
});

describe("run-wait parseRunId() (#984)", () => {
  it("accepts a positive integer", () => {
    expect(parseRunId("123")).toBe(123);
    expect(parseRunId("1")).toBe(1);
  });

  it("rejects non-positive / non-integer / non-numeric / missing args", () => {
    for (const bad of ["0", "-5", "1.5", "abc", "12x", "", undefined, null]) {
      expect(parseRunId(bad as string | undefined)).toBeNull();
    }
  });
});
