import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/stage-b-lint.ts` (#692).
 *
 * The Stage-B merge guard blocks a user-facing PR from merging without a
 * recorded product-owner Stage-B GO (AGENTS.md §6). Like registry-research /
 * spec-link it reaches GitHub through `gh pr view` / `gh issue view`, stubbed
 * here via the `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts): each case ships a canned
 * `gh/pr-view-<n>.json` (and, when the marker lives on a linked Issue,
 * `gh/issue-view-<n>.json`), and the run sets the Actions context
 * (`GITHUB_EVENT_NAME`, `PR_NUMBER`) so the guard's real env-resolution +
 * surface detection + marker-evidence logic all run.
 *
 * The frontmatter-heuristic cases (`*-ds-*`) additionally ship a spec tree under
 * the case dir (served through `LINT_FIXTURE_ROOT`) so the guard's
 * label→spec-folder→`surface:` resolution runs against a fixture requirements
 * file rather than the real repo.
 *
 * `red-no-marker` is the regression pin for the #691 miss: a portal render PR
 * with no Stage-B record must fail.
 */
const GUARD = "stage-b-lint.ts";

/** Standard pull_request context pointing the gh seam at a case's canned JSON. */
function prEnv(prNumber: string, ghCase: string): Record<string, string> {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_GH_FIXTURE_DIR: ghDir("stage-b", ghCase),
  };
}

describe("stage-b-lint", () => {
  it("green: portal render + `Stage-B: GO` in body → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-body-go"), {
      env: prEnv("200", "green-body-go"),
    });
    expect(code).toBe(0);
  });

  it("green: admin render + `Stage-B: batched at #700` (batched-gate carve-out) → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-body-batched"), {
      env: prEnv("201", "green-body-batched"),
    });
    expect(code).toBe(0);
  });

  it("green (#699): portal render + lead-certification token (em-dash `— lead-certified`) → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-body-lead-certified"),
      { env: prEnv("211", "green-body-lead-certified") },
    );
    expect(code).toBe(0);
  });

  it("green (#699): admin render + lead-certification token (ASCII hyphen `- lead-certified`) → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-body-lead-certified-ascii"),
      { env: prEnv("212", "green-body-lead-certified-ascii") },
    );
    expect(code).toBe(0);
  });

  it("green: portal render, no body marker but a linked-Issue comment carries GO → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("stage-b", "green-comment-go"), {
      env: prEnv("202", "green-comment-go"),
    });
    expect(code).toBe(0);
  });

  it("red (#691 regression): portal render + no Stage-B marker anywhere → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-no-marker"),
      { env: prEnv("203", "red-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B");
  });

  it("red (#1722): doctor-storefront render + no Stage-B marker → exit 1", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "red-doctor-no-marker"),
      {
        env: prEnv("213", "red-doctor-no-marker"),
      },
    );
    expect(code).toBe(1);
  });

  it("red (#1722): shared room-package render + no Stage-B marker → exit 1", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "red-room-package-no-marker"),
      { env: prEnv("214", "red-room-package-no-marker") },
    );
    expect(code).toBe(1);
  });

  it("red: portal render + a placeholder marker (`Stage-B: TBD`) → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-empty-marker"),
      { env: prEnv("204", "red-empty-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B decision");
  });

  it("skip: backend-only PR (apps/api) → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-backend-only"),
      { env: prEnv("205", "skip-backend-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("skip: docs-only PR → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-docs-only"),
      { env: prEnv("206", "skip-docs-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("skip: test-only change under a UI surface (spec/e2e exempt) → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-test-only"),
      { env: prEnv("207", "skip-test-only") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("rule does not apply");
  });

  it("green (frontmatter heuristic): design-system render + user-facing spec + GO → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("stage-b", "green-ds-userfacing-spec"),
      { env: prEnv("208", "green-ds-userfacing-spec") },
    );
    expect(code).toBe(0);
  });

  it("red (frontmatter heuristic): design-system render + user-facing spec + no marker → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-ds-userfacing-no-marker"),
      { env: prEnv("209", "red-ds-userfacing-no-marker") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B");
  });

  it("red: design-system render cannot be waived by a backend-only feature label", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "skip-ds-nonuserfacing-spec"),
      { env: prEnv("210", "skip-ds-nonuserfacing-spec") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Stage-B");
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "green-body-go"),
      {
        env: {
          GITHUB_EVENT_NAME: "push",
          LINT_GH_FIXTURE_DIR: ghDir("stage-b", "green-body-go"),
        },
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("skipping");
  });

  it("green (#2581): reviewer-certified copy-only PR + GO without a live URL → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("stage-b", "green-copy-only-no-live-url"),
      { env: prEnv("2581", "green-copy-only-no-live-url") },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("copy-only");
  });

  it("red (#2581): copy-only claim the reviewer did not certify still needs the live URL → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("stage-b", "red-copy-only-uncertified"),
      { env: prEnv("2582", "red-copy-only-uncertified") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("live URL");
  });

  describe("#2699", () => {
    const run = (
      name: string,
      pr: string,
      extra: Record<string, string> = {},
      extraArgs: string[] = [],
    ) =>
      runGuard(GUARD, caseDir("stage-b", name), {
        env: { ...prEnv(pr, name), STAGE_B_CI_PHASE: "", ...extra },
        extraArgs,
      });

    it("green: UI files + a spec / test / ui-evidence file resolve the Stage-B route from the UI files alone (show GO on a capture) → exit 0", () => {
      const { code, stdout } = run("green-route-runtime-only", "220");
      expect(code).toBe(0);
      expect(stdout).toContain("Stage-B route tier show");
    });

    it("green: lead-certified N/A, not environment-sensitive, green CI e2e on the head + captures, no slot report → exit 0", () => {
      const { code } = run("green-lead-slot-free", "221");
      expect(code).toBe(0);
    });

    it("red: lead-certified N/A whose CI e2e check failed on the head → exit 1", () => {
      const { code, stderr } = run("red-lead-slot-free-ci-failed", "222");
      expect(code).toBe(1);
      expect(stderr).toContain("playwright-axe-portal");
    });

    it("red: lead-certified N/A on an environment-sensitive PR still needs the live slot report → exit 1", () => {
      const { code, stderr } = run("red-lead-env-sensitive", "223");
      expect(code).toBe(1);
      expect(stderr).toContain("apps/api/src/mailer/notice-emails.ts");
    });

    it("lead-certified N/A with the CI e2e check still running: tolerated pre-CI, refused post-CI", () => {
      expect(
        run("lead-slot-free-ci-pending", "225", {}, ["--pre-ci"]).code,
      ).toBe(0);
      expect(run("lead-slot-free-ci-pending", "225").code).toBe(1);
    });

    it("red: a pre-CI phase inherited from the shell environment does not relax the post-CI pass → exit 1", () => {
      expect(
        run("lead-slot-free-ci-pending", "225", { STAGE_B_CI_PHASE: "pre-ci" })
          .code,
      ).toBe(1);
    });

    it("red: UI files + an apps/api runtime file route ask, so a show GO on a capture is refused → exit 1", () => {
      const { code, stdout, stderr } = run("red-route-runtime-api", "226");
      expect(code).toBe(1);
      expect(stdout).not.toContain("Stage-B route tier show");
      expect(stderr).toContain("live URL");
    });

    it("red: an owner quote copied verbatim from a repo instruction file is refused → exit 1", () => {
      const { code, stderr } = run("red-owner-quote-instruction", "224");
      expect(code).toBe(1);
      expect(stderr).toContain("AGENTS.md");
      expect(stderr).toContain("not an owner decision");
    });
  });
});
