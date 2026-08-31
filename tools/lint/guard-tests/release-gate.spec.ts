import { describe, expect, it } from "vitest";

import {
  RELEASE_BLOCKER_LABEL,
  RELEASE_GATE_EXEMPT_FLAG,
  evaluateReleaseGate,
  extractBatchedGateRefs,
  extractClosedIssues,
  formatReleaseGateClear,
  formatReleaseGateHold,
  parseReleaseGateExempt,
} from "../../deploy/release-gate.mjs";

/**
 * Unit cover for the deploy release gate (#1662). Mirrors
 * `project-reality.spec.ts`: the gh/git I/O (`probeReleaseGate`) is a
 * subprocess seam; the flag parser, the marker parser, the evaluator and the
 * formatters are pure and tested here with FABRICATED probes — no subprocess,
 * no network, no FS, and no platform-specific path literals (CI is Linux).
 */

const probe = (over: Record<string, unknown> = {}) => ({
  blockers: [] as Array<{ number: number; title: string }>,
  openBatched: [] as Array<{ pr: number; gate: number; gateTitle: string }>,
  basisSha: "b9d81e6a1c2d3e4f5061728394a5b6c7d8e9f0a1",
  ...over,
});

describe("release-gate parseReleaseGateExempt()", () => {
  it("is not exempt when the flag is absent", () => {
    expect(parseReleaseGateExempt(["--skip-ci-check"])).toEqual({
      exempt: false,
      reason: null,
    });
  });

  it("accepts an explicit non-empty reason", () => {
    const r = parseReleaseGateExempt([
      RELEASE_GATE_EXEMPT_FLAG,
      "owner go — the fix ships in this very range",
    ]);
    expect(r.exempt).toBe(true);
    expect(r.reason).toBe("owner go — the fix ships in this very range");
  });

  it("refuses a bare flag (no silent bypass)", () => {
    const r = parseReleaseGateExempt([RELEASE_GATE_EXEMPT_FLAG]);
    expect(r.exempt).toBe(false);
    expect(r.error).toContain("non-empty reason");
  });

  it("refuses the next flag as a reason", () => {
    const r = parseReleaseGateExempt([
      RELEASE_GATE_EXEMPT_FLAG,
      "--skip-ci-check",
    ]);
    expect(r.exempt).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("refuses a whitespace-only reason", () => {
    expect(
      parseReleaseGateExempt([RELEASE_GATE_EXEMPT_FLAG, "   "]).exempt,
    ).toBe(false);
  });
});

describe("release-gate extractBatchedGateRefs()", () => {
  it("reads a batched marker out of a PR body", () => {
    expect(
      extractBatchedGateRefs("Closes #1\n\nStage-B: batched at #1300\n"),
    ).toEqual([1300]);
  });

  it("tolerates blockquote/list decoration and StageB casing", () => {
    expect(
      extractBatchedGateRefs("> - StageB : Batched At #700 (epic gate)"),
    ).toEqual([700]);
  });

  it("collects several distinct gates, deduped in first-seen order", () => {
    const body = [
      "Stage-B: batched at #1348",
      "Stage-B: batched at #1300",
      "Stage-B: batched at #1348",
    ].join("\n");
    expect(extractBatchedGateRefs(body)).toEqual([1348, 1300]);
  });

  it("ignores a Stage-B GO and a lead self-certification", () => {
    expect(extractBatchedGateRefs("Stage-B: GO — owner 2026-08-27")).toEqual(
      [],
    );
    expect(
      extractBatchedGateRefs(
        "Stage-B: N/A (no visual surface) — lead-certified",
      ),
    ).toEqual([]);
  });

  it("ignores a body with no marker at all, and a null body", () => {
    expect(extractBatchedGateRefs("Closes #1662\n\nauthor:claude")).toEqual([]);
    expect(extractBatchedGateRefs(null)).toEqual([]);
    expect(extractBatchedGateRefs(undefined)).toEqual([]);
  });

  it("reads the marker out of an ISSUE COMMENT blob too (accepted source parity)", () => {
    // The merge guard (tools/lint/stage-b-lint.ts) accepts the record in the PR
    // body OR in a comment on a linked `Closes #N` Issue; the deploy gate feeds
    // comment bodies through this same parser.
    expect(
      extractBatchedGateRefs(
        "Live walkthrough deferred.\n\nStage-B: batched at #1348\n\n— lead",
      ),
    ).toEqual([1348]);
  });

  it("is re-entrancy-safe: repeated calls do not skip matches", () => {
    const body = "Stage-B: batched at #1300";
    expect(extractBatchedGateRefs(body)).toEqual([1300]);
    expect(extractBatchedGateRefs(body)).toEqual([1300]);
    expect(extractBatchedGateRefs(body)).toEqual([1300]);
  });
});

describe("release-gate extractClosedIssues()", () => {
  it("collects every auto-close keyword form, deduped in first-seen order", () => {
    expect(
      extractClosedIssues(
        "Closes #1662\nfixes #700\nRESOLVED #42\nCloses #1662 again",
      ),
    ).toEqual([1662, 700, 42]);
  });

  it("ignores a bare reference and a non-close mention", () => {
    expect(extractClosedIssues("Part of #1430, see #1300")).toEqual([]);
  });

  it("returns [] for an empty/absent body", () => {
    expect(extractClosedIssues("")).toEqual([]);
    expect(extractClosedIssues(null)).toEqual([]);
    expect(extractClosedIssues(undefined)).toEqual([]);
  });
});

describe("release-gate evaluateReleaseGate()", () => {
  it("clears when there is no blocker and no open batched gate", () => {
    const v = evaluateReleaseGate(probe());
    expect(v.hold).toBe(false);
    expect(v.reasons).toEqual([]);
    expect(formatReleaseGateHold(v)).toBeNull();
  });

  it("holds on an open release-blocker Issue, naming number + title", () => {
    const v = evaluateReleaseGate(
      probe({
        blockers: [{ number: 1642, title: "webinars cursor regression" }],
      }),
    );
    expect(v.hold).toBe(true);
    const msg = formatReleaseGateHold(v) ?? "";
    expect(msg).toContain("#1642");
    expect(msg).toContain("webinars cursor regression");
    expect(msg).toContain(RELEASE_GATE_EXEMPT_FLAG);
  });

  it("holds on a merged-undeployed PR whose batched gate is open, naming the pair", () => {
    const v = evaluateReleaseGate(
      probe({
        openBatched: [
          { pr: 1582, gate: 1300, gateTitle: "Stage-B walkthrough" },
        ],
      }),
    );
    expect(v.hold).toBe(true);
    const msg = formatReleaseGateHold(v) ?? "";
    expect(msg).toContain("PR #1582");
    expect(msg).toContain("gate #1300");
  });

  it("fails closed when the blocker query could not run", () => {
    const v = evaluateReleaseGate(
      probe({ blockers: null, blockersError: "gh: HTTP 502" }),
    );
    expect(v.hold).toBe(true);
    expect(v.reasons.join("\n")).toContain("UNKNOWN");
    expect(v.reasons.join("\n")).toContain("gh: HTTP 502");
  });

  it("fails closed when the merged-undeployed delta could not be enumerated", () => {
    const v = evaluateReleaseGate(
      probe({
        openBatched: null,
        openBatchedError: "no production GitHub Deployment recorded",
        basisSha: null,
      }),
    );
    expect(v.hold).toBe(true);
    expect(v.reasons.join("\n")).toContain("merged-but-not-deployed");
  });

  it("fails closed when the delta basis is the Deployment record, not live health", () => {
    // An app-only `--rollback` records NO Deployment, so the recorded SHA can be
    // NEWER than what runs and the range too narrow — a fail-open exactly when
    // the train is known-sick. A degraded basis therefore HOLDS.
    const v = evaluateReleaseGate(
      probe({ basisDegraded: "live health probe failed: health 502" }),
    );
    expect(v.hold).toBe(true);
    const msg = formatReleaseGateHold(v) ?? "";
    expect(msg).toContain("UNKNOWN");
    expect(msg).toContain("health 502");
  });

  it("does not add the degraded-basis reason when live health anchored the delta", () => {
    expect(evaluateReleaseGate(probe()).hold).toBe(false);
  });

  it("fails closed on an empty/absent probe rather than clearing", () => {
    expect(evaluateReleaseGate(undefined as never).hold).toBe(true);
  });

  it("reports every blocker and every pair in one verdict", () => {
    const v = evaluateReleaseGate(
      probe({
        blockers: [
          { number: 1, title: "one" },
          { number: 2, title: "two" },
        ],
        openBatched: [
          { pr: 10, gate: 20, gateTitle: "gate a" },
          { pr: 11, gate: 21, gateTitle: "gate b" },
        ],
      }),
    );
    const msg = formatReleaseGateHold(v) ?? "";
    for (const needle of ["#1 one", "#2 two", "PR #10", "PR #11"]) {
      expect(msg).toContain(needle);
    }
  });
});

describe("release-gate formatReleaseGateClear()", () => {
  it("names the label and abbreviates the delta basis", () => {
    const line = formatReleaseGateClear(
      "b9d81e6a1c2d3e4f5061728394a5b6c7d8e9f0a1",
    );
    expect(line).toContain(RELEASE_BLOCKER_LABEL);
    expect(line).toContain("b9d81e6a1c2d");
  });

  it("renders without a basis when none was derived", () => {
    expect(formatReleaseGateClear(null)).not.toContain("(delta basis");
  });
});
