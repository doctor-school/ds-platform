import { describe, expect, it } from "vitest";

import {
  GUARDS,
  MERGE_GUARDS,
  STATIC_GUARDS,
  hasNoStaticFlag,
  hasPreMergeFlag,
  hasStaticFlag,
  parsePrNumber,
  resolvePlan,
  summarize,
} from "../pr-preflight.mjs";

/**
 * Unit cover for `tools/lint/pr-preflight.mjs`'s pure seams (#406). The impure
 * half (spawning each guard with `GITHUB_EVENT_NAME=pull_request PR_NUMBER=<N>`)
 * is exercised live against a real PR; only the guard roster, arg parsing, and
 * summary derivation are unit-tested here, on the established guard-test harness
 * (imports the pure exports, never fires `main()`).
 */
describe("pr-preflight GUARDS roster", () => {
  it("runs exactly the five PR-event-gated guards", () => {
    expect(GUARDS.map((g) => g.name)).toEqual([
      "registry-research",
      "spec-link",
      "prior-decisions",
      "spec-status-fresh",
      "product-note",
    ]);
  });

  it("maps each guard to its tools/lint/*.ts entrypoint", () => {
    for (const g of GUARDS) {
      expect(g.file).toMatch(/^[a-z-]+-lint\.ts$/);
    }
  });
});

describe("pr-preflight STATIC_GUARDS roster (#462)", () => {
  it("maps each static guard to a tools/lint/*.ts entrypoint", () => {
    expect(STATIC_GUARDS.length).toBeGreaterThan(0);
    for (const g of STATIC_GUARDS) {
      expect(g.file).toMatch(/-lint\.ts$/);
    }
  });

  it("excludes the four PR-gated guards and the Nest-booting endpoint-authz", () => {
    const staticFiles = new Set(STATIC_GUARDS.map((g) => g.file));
    // the PR-event-gated family runs in the base sweep, never the static one.
    for (const g of GUARDS) expect(staticFiles.has(g.file)).toBe(false);
    // tdd-signal is also PR-event-gated; endpoint-authz boots a Nest context.
    expect(staticFiles.has("tdd-signal-lint.ts")).toBe(false);
    expect(staticFiles.has("endpoint-authz-lint.ts")).toBe(false);
  });

  it("has no duplicate entrypoints", () => {
    const files = STATIC_GUARDS.map((g) => g.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("pr-preflight MERGE_GUARDS roster (#692)", () => {
  it("holds the stage-b pre-merge gate mapped to its entrypoint", () => {
    expect(MERGE_GUARDS.map((g) => g.name)).toEqual(["stage-b"]);
    for (const g of MERGE_GUARDS) expect(g.file).toMatch(/-lint\.ts$/);
  });

  it("is disjoint from the PR-gated and static families", () => {
    const other = new Set([
      ...GUARDS.map((g) => g.file),
      ...STATIC_GUARDS.map((g) => g.file),
    ]);
    for (const g of MERGE_GUARDS) expect(other.has(g.file)).toBe(false);
  });
});

describe("pr-preflight hasPreMergeFlag() (#692)", () => {
  it("detects --pre-merge and the --stage-b alias anywhere in argv", () => {
    expect(hasPreMergeFlag(["692", "--pre-merge"])).toBe(true);
    expect(hasPreMergeFlag(["692", "--stage-b"])).toBe(true);
    expect(hasPreMergeFlag(["692"])).toBe(false);
    expect(hasPreMergeFlag([])).toBe(false);
  });
});

describe("pr-preflight hasStaticFlag()", () => {
  it("detects the --static flag anywhere in argv", () => {
    expect(hasStaticFlag(["--static"])).toBe(true);
    expect(hasStaticFlag(["406", "--static"])).toBe(true);
    expect(hasStaticFlag(["406"])).toBe(false);
    expect(hasStaticFlag([])).toBe(false);
  });
});

describe("pr-preflight hasNoStaticFlag()", () => {
  it("detects the --no-static opt-out anywhere in argv", () => {
    expect(hasNoStaticFlag(["--no-static"])).toBe(true);
    expect(hasNoStaticFlag(["633", "--no-static"])).toBe(true);
    expect(hasNoStaticFlag(["633"])).toBe(false);
    expect(hasNoStaticFlag(["--static"])).toBe(false);
    expect(hasNoStaticFlag([])).toBe(false);
  });
});

describe("pr-preflight resolvePlan() (#633)", () => {
  it("runs the static family by DEFAULT in PR-number mode", () => {
    const plan = resolvePlan(["633"]);
    expect(plan.prNumber).toBe("633");
    expect(plan.runPrGated).toBe(true);
    expect(plan.runStatic).toBe(true);
    expect(plan.usageError).toBe(false);
  });

  it("skips the static family when --no-static is passed with a PR number", () => {
    const plan = resolvePlan(["633", "--no-static"]);
    expect(plan.runPrGated).toBe(true);
    expect(plan.runStatic).toBe(false);
    expect(plan.usageError).toBe(false);
  });

  it("runs static-only for standalone --static (no PR number), unchanged", () => {
    const plan = resolvePlan(["--static"]);
    expect(plan.prNumber).toBeNull();
    expect(plan.runPrGated).toBe(false);
    expect(plan.runStatic).toBe(true);
    expect(plan.usageError).toBe(false);
  });

  it("runs both families for --static with a PR number, unchanged", () => {
    const plan = resolvePlan(["--static", "633"]);
    expect(plan.runPrGated).toBe(true);
    expect(plan.runStatic).toBe(true);
    expect(plan.usageError).toBe(false);
  });

  it("is a usage error when nothing is selected", () => {
    expect(resolvePlan([]).usageError).toBe(true);
    // --no-static alone selects nothing to run.
    expect(resolvePlan(["--no-static"]).usageError).toBe(true);
  });

  it("lets explicit --static win over --no-static", () => {
    const plan = resolvePlan(["633", "--static", "--no-static"]);
    expect(plan.runStatic).toBe(true);
  });

  it("runs the pre-merge gate only with --pre-merge AND a PR number (#692)", () => {
    expect(resolvePlan(["692", "--pre-merge"]).runMergeGate).toBe(true);
    expect(resolvePlan(["692", "--stage-b"]).runMergeGate).toBe(true);
    // default create-time preflight never runs the merge gate
    expect(resolvePlan(["692"]).runMergeGate).toBe(false);
    // --pre-merge without a PR number selects nothing runnable → usage error
    expect(resolvePlan(["--pre-merge"]).runMergeGate).toBe(false);
    expect(resolvePlan(["--pre-merge"]).usageError).toBe(true);
  });
});

describe("pr-preflight parsePrNumber()", () => {
  it("reads the first positional arg as the PR number", () => {
    expect(parsePrNumber(["406"])).toBe("406");
  });

  it("ignores --flags before the positional", () => {
    expect(parsePrNumber(["--verbose", "406"])).toBe("406");
  });

  it("returns null for a missing or non-numeric arg", () => {
    expect(parsePrNumber([])).toBeNull();
    expect(parsePrNumber(["abc"])).toBeNull();
    expect(parsePrNumber(["#406"])).toBeNull();
  });
});

describe("pr-preflight summarize()", () => {
  it("is ok only when every guard exited zero", () => {
    expect(
      summarize([
        { name: "registry-research", status: 0 },
        { name: "spec-link", status: 0 },
      ]).ok,
    ).toBe(true);
    expect(
      summarize([
        { name: "registry-research", status: 1 },
        { name: "spec-link", status: 0 },
      ]).ok,
    ).toBe(false);
  });

  it("emits one PASS/FAIL line per guard, in order", () => {
    const { lines } = summarize([
      { name: "registry-research", status: 0 },
      { name: "spec-link", status: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("PASS");
    expect(lines[0]).toContain("registry-research");
    expect(lines[1]).toContain("FAIL");
    expect(lines[1]).toContain("spec-link");
  });
});
