import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/host-allowlist-lint.ts` (#2002 slice A).
 *
 * The guard is the TREE check of the one-code-two-storefronts plan (tech spec
 * `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3, first bullet):
 * every `apps/{portal,doctor}` `.ts`/`.tsx` file that is not a Next.js route
 * file, a test or `e2e/**` needs an exact-path row in the checked-in answer key
 * (`capability-ownership.md` → «Host-file allowlist»). The dead-glob self-test
 * is the other half: a row naming a file that no longer exists, or a row
 * written as a glob, is itself a finding — otherwise the answer key rots and
 * the tree check silently passes on a pattern that matches everything.
 *
 * The «Honest limit» bullet is the pull_request half: a diff touching a file
 * whose row `until` names an extraction wave is flagged with the row quoted, so
 * growth of a doomed file is visible. `permanent` rows are host-only by
 * decision and never flag.
 *
 * Each case points `LINT_FIXTURE_ROOT` at a mini repo tree and asserts the exit
 * code (0 pass / 1 fail) plus a stable message substring. Engineering-task, so
 * the test ids are `2002:` rather than EARS ids.
 */
const GUARD = "host-allowlist-lint.ts";
const dir = (name: string) => caseDir("host-allowlist", name);
const gh = (name: string) => ghDir("host-allowlist", name);

/**
 * Ambient CI values must be overridden: the `unit` job runs inside a real
 * `pull_request` event, which would otherwise pull the honest-limit branch into
 * the tree-only cases.
 */
const TREE_ONLY = { GITHUB_EVENT_NAME: "push", PR_NUMBER: "" };

describe("host-allowlist-lint", () => {
  it("2002: green — every scanned file has an exact row and every row names a live file → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), { env: TREE_ONLY });
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("2002: red — an unlisted `apps/doctor/lib/x.ts` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unlisted-lib"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/lib/x.ts");
    expect(stderr).toContain("no allowlist row");
  });

  it("2002: red — an unlisted helper in a `hooks/` directory (the renamed-directory bypass) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unlisted-hooks"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/hooks/use-x.ts");
  });

  it("2002: red — an unlisted client component beside a `page.tsx` → exit 1 (the page itself is exempt)", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unlisted-app-client"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/foo/foo-client.tsx");
    expect(stderr).not.toContain("app/foo/page.tsx");
  });

  it("2002: green — route files, tests, `e2e/**`, `*.d.ts` and app-root config need no row → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-route-files-exempt"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("2002: red — a stale row naming a file that no longer exists (dead-glob self-test) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-stale-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/lib/gone.ts");
    expect(stderr).toContain("stale row");
  });

  it("2002: red — a row written as a glob instead of an exact path → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-glob-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("glob row");
  });

  it("2002: honest limit — a PR touching a row whose `until` names a wave → exit 1 with the row quoted", () => {
    const { code, stderr } = runGuard(GUARD, dir("warn-until-wave-touch"), {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "300",
        LINT_GH_FIXTURE_DIR: gh("warn-until-wave-touch"),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/lib/a.ts");
    expect(stderr).toContain("wave 1");
  });

  it("2002: honest limit — the same touch on a `permanent` row is not a finding → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-until-permanent-touch"), {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "301",
        LINT_GH_FIXTURE_DIR: gh("green-until-permanent-touch"),
      },
    });
    expect(code).toBe(0);
  });
});
