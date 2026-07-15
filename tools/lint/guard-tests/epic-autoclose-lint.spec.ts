import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The guard imports its PURE seams directly — the `IS_ENTRY` guard in the source
// means importing these does NOT fire `main()`'s `gh` calls (same pattern as
// tools/backlog-triage.ts + its spec).
import {
  evaluateEpicAutoclose,
  parseClosingRefs,
  SEVERITY,
  type EpicGraph,
  type GraphLookup,
} from "../epic-autoclose-lint";
import { caseDir, ghDir, runGuard } from "./run-guard";

const GUARD = "epic-autoclose-lint.ts";

/**
 * Load a pure-seam fixture case: its `pr-body.md` text + a `graph.json` map of
 * `issue# -> { openChildren }`, resolved into a `GraphLookup`. NO network — the
 * graph is fixture data, exactly the #964 acceptance seam.
 */
function loadCase(name: string): { body: string; lookup: GraphLookup } {
  const dir = caseDir("epic-autoclose", name);
  const body = readFileSync(resolve(dir, "pr-body.md"), "utf8");
  const graph = JSON.parse(
    readFileSync(resolve(dir, "graph.json"), "utf8"),
  ) as Record<string, EpicGraph>;
  const lookup: GraphLookup = (n) => graph[String(n)];
  return { body, lookup };
}

describe("epic-autoclose-lint — pure seam", () => {
  it("ships as WARN (single-constant severity for the BLOCK promotion)", () => {
    expect(SEVERITY).toBe("WARN");
  });

  it("parses the GitHub closing keywords case-insensitively, deduped in order", () => {
    const body =
      "Closes #12\nfixes #12\nResolves #7\nRelated #99 (not a close)";
    expect(parseClosingRefs(body)).toEqual([12, 7]);
  });

  it("does not treat a bare mention as a closing ref", () => {
    expect(parseClosingRefs("See #927 for context")).toEqual([]);
  });

  it("WARNs: `Closes #<epic>` where the epic has open sub-issues, naming children", () => {
    const { body, lookup } = loadCase("epic-open-children");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual([{ epic: 927, openChildren: [928, 930, 931] }]);
    expect(v.message).toContain("#928");
    expect(v.message).toContain("#930");
    expect(v.message).toContain("#931");
    expect(v.message).toContain("Link the specific child sub-issue");
  });

  it("passes: a PR closing a leaf issue (no sub-issues)", () => {
    const { body, lookup } = loadCase("leaf");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("passes: an epic whose sub-issues are all closed", () => {
    const { body, lookup } = loadCase("epic-all-closed");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("flags only the offending epic when a PR closes both a leaf and an epic", () => {
    const { body, lookup } = loadCase("multi-ref");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(false);
    expect(v.closingRefs).toEqual([500, 927]);
    expect(v.offenders).toEqual([{ epic: 927, openChildren: [928] }]);
  });

  it("resolves a lowercase, colon-separated closing keyword", () => {
    const { body, lookup } = loadCase("case-insensitive");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual([{ epic: 927, openChildren: [928] }]);
  });

  it("passes trivially when the body has no closing keyword", () => {
    const { body, lookup } = loadCase("no-refs");
    const v = evaluateEpicAutoclose(body, lookup);
    expect(v.ok).toBe(true);
    expect(v.message).toContain("no closing-keyword reference");
  });
});

/**
 * Exit-code harness for the thin I/O wrapper. `gh pr view` is stubbed via
 * `LINT_GH_FIXTURE_DIR`; the native sub-issues fetch via
 * `LINT_SUBISSUES_FIXTURE_DIR`. Still NO network.
 */
function subDir(name: string): string {
  return resolve(caseDir("epic-autoclose", name), "sub");
}
function prEnv(
  prNumber: string,
  name: string,
  withSub = true,
): Record<string, string> {
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("epic-autoclose", name),
  };
  if (withSub) env.LINT_SUBISSUES_FIXTURE_DIR = subDir(name);
  return env;
}

describe("epic-autoclose-lint — exit-code harness", () => {
  it("red: `Closes #927` where #927 has open sub-issues → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("epic-autoclose", "harness-red"),
      { env: prEnv("964", "harness-red") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("#928");
    expect(stderr).toContain("#930");
  });

  it("green: `Fixes #500` on a leaf issue → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("epic-autoclose", "harness-green-leaf"),
      { env: prEnv("965", "harness-green-leaf") },
    );
    expect(code).toBe(0);
  });

  it("skip: PR body with no closing keyword → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("epic-autoclose", "harness-skip"),
      { env: prEnv("966", "harness-skip", false) },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("no closing-keyword reference");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("epic-autoclose", "harness-skip"),
      { env: { GITHUB_EVENT_NAME: "push" } },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});
