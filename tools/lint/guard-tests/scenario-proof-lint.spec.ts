import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/scenario-proof-lint.ts` (regression-contour
 * tech spec §6.1/§6.4, Issue #4062). Each case points three seams at a fixture
 * case dir: `LINT_FIXTURE_ROOT` (the mini repo tree: specs, step definitions,
 * test files, the debt list), `LINT_PROOF_BASE_DEBT_FILE` (the debt list as it
 * stood at the merge base; a missing file = the list did not exist there) and
 * `LINT_GH_FIXTURE_DIR` (canned `gh issue view` JSON for new tracked entries).
 *
 * Every scenario is bound, proof-tagged, pending (Draft spec) or unproven, and
 * the unproven ones are exactly the debt list. The `green` case carries every
 * state plus the discriminators that must not fire: a nested test id proving a
 * flat EARS tag, a multi-level tag satisfied at one of its levels, a scenario
 * both bound and tagged, a repeated title keyed `[2]`, a new entry tracked by an
 * OPEN Issue, an outline bound through its `Examples` row, and an API proof
 * named by an explicit `001 EARS-3` title in a file that also cites spec 002.
 */
const GUARD = "scenario-proof-lint.ts";
const dir = (name: string) => caseDir("scenario-proof", name);
const feature =
  "apps/docs/content/specs/features/001-alpha/001-scenarios.feature";

const seams = (name: string) => ({
  env: {
    LINT_PROOF_BASE_DEBT_FILE: resolve(dir(name), "base-debt.txt"),
    LINT_GH_FIXTURE_DIR: ghDir("scenario-proof", name),
  },
});

describe("scenario-proof-lint", () => {
  it("green: bound, every proof level, Draft pending and listed debt → exit 0", () => {
    const { code, stdout, stderr } = runGuard(
      GUARD,
      dir("green"),
      seams("green"),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("report: one row per spec plus a totals row, each scenario in one state", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), {
      ...seams("green"),
      extraArgs: ["--report"],
    });
    expect(code).toBe(0);
    expect(stdout).toContain(
      "| spec | total | bound | proof:unit | proof:api | proof:app-e2e | pending | unproven |",
    );
    expect(stdout).toContain("| 001 | 10 | 3 | 1 | 1 | 1 | 0 | 4 |");
    expect(stdout).toContain("| 002 | 2 | 0 | 0 | 0 | 0 | 2 | 0 |");
    expect(stdout).toContain("| total | 12 | 3 | 1 | 1 | 1 | 2 | 4 |");
  });

  it("red: an unproven scenario missing from the debt list → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-unlisted"),
      seams("red-unlisted"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("001 | forgotten scenario");
    expect(stderr).toContain("unproven scenario missing from");
    expect(stderr).not.toContain("001 | listed scenario");
  });

  it("red: a debt entry whose scenario is bound or gone is stale → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-stale"),
      seams("red-stale"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | now bound -> stale debt entry: the scenario is bound",
    );
    expect(stderr).toContain(
      "001 | vanished scenario -> stale debt entry: no such scenario",
    );
  });

  it("red: a new debt entry without an Issue, a CLOSED, missing or PR number → exit 1", () => {
    const { code, stdout, stderr } = runGuard(GUARD, dir("red-new-entry"), {
      env: { ...seams("red-new-entry").env, CI: "" },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | untracked new debt -> new debt entry (absent at the merge base) names no #<issue>",
    );
    expect(stderr).toContain(
      "001 | closed issue debt -> new debt entry tracks Issue #9001, which is CLOSED",
    );
    expect(stderr).toContain(
      "001 | missing issue debt -> new debt entry names #9002, which is no Issue in this repository",
    );
    expect(stderr).toContain(
      "001 | pull request debt -> new debt entry names #9003, which is a pull request, not an Issue",
    );
    expect(stderr).not.toContain("001 | baseline debt");
    // Outside CI an unavailable lookup warns instead of blocking.
    expect(stderr).not.toContain("001 | unreachable lookup debt");
    expect(stdout).toContain(
      "WARN 001 | unreachable lookup debt -> could not look up #9004",
    );
  });

  it("red: under CI an Issue lookup that cannot run blocks → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-new-entry"), {
      env: { ...seams("red-new-entry").env, CI: "true" },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | unreachable lookup debt -> could not look up #9004",
    );
    expect(stderr).toContain("CI is set");
  });

  // No base-debt seam and a base ref that does not exist: `git merge-base`
  // fails, so the new-entry check cannot run.
  const noMergeBase = (ci: string) => ({
    env: {
      ...seams("green").env,
      LINT_PROOF_BASE_DEBT_FILE: "",
      LINT_DIFF_BASE: "refs/heads/scenario-proof-no-such-base",
      CI: ci,
    },
  });

  it("red: under CI an unavailable merge base blocks → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("green"), noMergeBase("true"));
    expect(code).toBe(1);
    expect(stderr).toContain("the merge base was unavailable");
    expect(stderr).toContain("CI is set: BLOCK");
  });

  it("green: outside CI an unavailable merge base warns → exit 0", () => {
    const { code, stdout, stderr } = runGuard(
      GUARD,
      dir("green"),
      noMergeBase(""),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("WARN the merge base was unavailable");
  });

  it("red: an outline with one unbound Examples row, a scenario with only Background steps → unproven", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-bound-rules"),
      seams("red-bound-rules"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | a later row unbound -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      "001 | background only -> unproven scenario missing from",
    );
    expect(stderr).not.toContain("001 | every row bound");
  });

  it("red: unknown level, no EARS tag and every unverifiable claim → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-proof-claims"),
      seams("red-proof-claims"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      `${feature}:5 "unknown level" -> @proof:browser names an unknown level (unit, api, app-e2e)`,
    );
    expect(stderr).toContain(
      `"proof without ears" -> @proof:unit on a scenario with no @EARS-N tag`,
    );
    // The only test is feature-agnostic.
    expect(stderr).toContain(
      `"agnostic only" -> @proof:unit claims EARS-2, but no 001-scoped test at level unit cites it`,
    );
    // The only test is at another level.
    expect(stderr).toContain(
      `"wrong level" -> @proof:api claims EARS-3, but no 001-scoped test at level api cites it`,
    );
    // The only test is another spec's same-numbered id.
    expect(stderr).toContain(
      `"other spec" -> @proof:unit claims EARS-4, but no 001-scoped test at level unit cites it`,
    );
    // In a file citing two specs a bare id belongs to neither; another spec's
    // explicitly prefixed id never proves this spec's.
    expect(stderr).toContain(
      `"two-spec file" -> @proof:unit claims EARS-6, but no 001-scoped test at level unit cites it`,
    );
    // packages/e2e is the binding harness, not a proof level.
    expect(stderr).toContain(
      `"harness only" -> @proof:unit claims EARS-5, but no 001-scoped test at level unit cites it`,
    );
  });

  it("--write-debt generates the list the guard then accepts", () => {
    const work = mkdtempSync(join(tmpdir(), "scenario-proof-"));
    try {
      cpSync(dir("red-unlisted"), work, { recursive: true });
      const env = {
        env: { LINT_PROOF_BASE_DEBT_FILE: join(work, "base-debt.txt") },
      };
      const written = runGuard(GUARD, work, {
        ...env,
        extraArgs: ["--write-debt"],
      });
      expect(written.code).toBe(0);
      const list = readFileSync(
        join(work, "packages", "e2e", "scenario-proof-debt.txt"),
        "utf8",
      );
      expect(list).toContain(
        "001 | forgotten scenario\n001 | listed scenario\n",
      );
      const checked = runGuard(GUARD, work, env);
      expect(checked.stderr).toBe("");
      expect(checked.code).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
