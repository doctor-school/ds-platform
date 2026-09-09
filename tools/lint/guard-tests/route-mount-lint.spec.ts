import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/route-mount-lint.ts` (#2002 slice D).
 *
 * The guard is the ROUTE-MOUNT check of the one-code-two-storefronts plan (tech
 * spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3, «Route
 * mount» bullet): a route file whose path the registry assigns to a package
 * imports that package's page export and, from the host, only its host-config
 * module; any other import or a body beyond mount + config fails. The negative
 * fixture the spec names verbatim — fetch-and-branch logic written straight
 * into `page.tsx` — is `red-fetch-and-branch`.
 *
 * The tree half mirrors slice A: every `apps/{portal,doctor}/app/**\/{page,layout}.tsx`
 * needs an exact-path row in «Route-file registry», every row must name a live
 * file, and a glob row is itself a finding. The honest limit is the
 * `pull_request` half: a diff touching a `wave N` route file is flagged with the
 * row quoted, because that page still carries inline host logic the guard does
 * not read.
 *
 * Each case points `LINT_FIXTURE_ROOT` at a mini repo tree and asserts the exit
 * code (0 pass / 1 fail) plus a stable message substring. Engineering-task, so
 * the test ids are `2002:` rather than EARS ids.
 */
const GUARD = "route-mount-lint.ts";
const dir = (name: string) => caseDir("route-mount", name);
const gh = (name: string) => ghDir("route-mount", name);

/**
 * Ambient CI values must be overridden: the `unit` job runs inside a real
 * `pull_request` event, which would otherwise pull the honest-limit branch into
 * the tree-only cases.
 */
const TREE_ONLY = { GITHUB_EVENT_NAME: "push", PR_NUMBER: "" };

describe("route-mount-lint", () => {
  it("2002: green — a `mounted` page that only mounts the package with its host config, a `wave N` page with inline logic and a `permanent` layout → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), { env: TREE_ONLY });
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("2002: red — fetch-and-branch logic written straight into a `mounted` `page.tsx` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-fetch-and-branch"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/events/page.tsx");
    expect(stderr).toContain("body beyond mount + config");
  });

  it("2002: red — a `mounted` page importing host logic (`@/lib/session`) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-foreign-import"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("foreign import");
    expect(stderr).toContain("@/lib/session");
  });

  it("2002: red — a route file with no registry row → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unregistered"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/foo/page.tsx");
    expect(stderr).toContain("no route-file registry row");
  });

  it("2002: red — a stale row naming a route file that no longer exists → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-stale-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/gone/page.tsx");
    expect(stderr).toContain("stale row");
  });

  it("2002: red — a row written as a glob instead of an exact path → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-glob-row"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("glob row");
  });

  it("2002: honest limit — a PR touching a `wave N` route file → exit 1 with the row quoted", () => {
    const { code, stderr } = runGuard(GUARD, dir("warn-until-wave-touch"), {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "400",
        LINT_GH_FIXTURE_DIR: gh("warn-until-wave-touch"),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("apps/doctor/app/(auth)/login/page.tsx");
    expect(stderr).toContain("wave 1 (#2027)");
  });
});
