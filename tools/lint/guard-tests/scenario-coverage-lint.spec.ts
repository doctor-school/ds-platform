import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/scenario-coverage-lint.ts` (regression-contour tech
 * spec §6.4 + §6.5, Issue #2067). Each case points three seams at a fixture case dir:
 * `LINT_FIXTURE_ROOT` (the mini spec tree), `LINT_DIFF_NAMESTATUS_FILE` (the declared
 * touched set, so severity is exercised without a real branch) and `LINT_GH_FIXTURE_DIR`
 * (canned `gh issue view` JSON, so the quarantine check runs with no GitHub round-trip).
 *
 * The three rules under test, exactly as §6.4/§6.5 write them:
 *   - an uncovered `EARS-N` in a spec THIS PR touched is a BLOCK;
 *   - the same finding in an untouched spec is a WARN row until the §8 backfill closes;
 *   - a quarantine that names no Issue, or names a CLOSED one, is a BLOCK wherever it
 *     sits — a test switched off with nobody tracking it is not backfill debt.
 * The `green` case carries the discriminators that must NOT fire: a `_Retired._` id
 * declares no handler, a `surface: backend-only` spec owns Vitest e2e instead of
 * scenarios (F-22), and a valid `@quarantine(#N)` on an OPEN Issue is fine as long as
 * its handler still has a live scenario.
 */
const GUARD = "scenario-coverage-lint.ts";
const dir = (name: string) => caseDir("scenario-coverage", name);

/** Point the diff + gh seams at the case's own fixtures. */
const seams = (name: string) => ({
  env: {
    LINT_DIFF_NAMESTATUS_FILE: resolve(dir(name), "diff.txt"),
    LINT_GH_FIXTURE_DIR: ghDir("scenario-coverage", name),
  },
});

describe("scenario-coverage-lint", () => {
  it("red: a declared EARS handler with no live scenario in a TOUCHED spec → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-missing-tag-touched"),
      seams("red-missing-tag-touched"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "apps/docs/content/specs/features/031-events-feed/031-scenarios.feature",
    );
    expect(stderr).toContain("uncovered handler(s): EARS-2");
    expect(stderr).toContain("touched spec(s) with an uncovered EARS handler");
  });

  it("red: a bare quarantine and a CLOSED-Issue quarantine in an UNTOUCHED spec → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-bad-quarantine"),
      seams("red-bad-quarantine"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("@quarantine names no Issue");
    expect(stderr).toContain("tracks Issue #9001, which is CLOSED");
  });

  it("warn: an uncovered handler in an UNTOUCHED spec → exit 0 with a WARN row", () => {
    const { code, stdout } = runGuard(
      GUARD,
      dir("warn-untouched"),
      seams("warn-untouched"),
    );
    expect(code).toBe(0);
    expect(stdout).toContain(
      "WARN apps/docs/content/specs/features/033-legacy-feed/033-scenarios.feature",
    );
    expect(stdout).toContain("uncovered handler(s): EARS-2");
    expect(stdout).toContain("untouched spec(s) carry uncovered handlers");
  });

  it("green: full coverage, an OPEN-Issue quarantine, a retired id and a backend-only spec → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), seams("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("scanned 1 user-facing feature spec(s).");
    expect(stdout).toContain("PASS");
  });
});
