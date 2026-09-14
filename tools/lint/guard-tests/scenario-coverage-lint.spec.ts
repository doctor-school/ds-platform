import { readFileSync } from "node:fs";
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
 * scenarios (F-22), a valid `@quarantine(#N)` on an OPEN Issue is fine as long as
 * its handler still has a live scenario — and the Feature-level `@host:*` tag every
 * spec feature file now carries (§6.1, `packages/e2e/lib/host-tags.ts`) is inherited
 * onto every scenario by `parseScenarios` WITHOUT being mistaken for a handler tag or
 * a quarantine.
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

  it("a host-tag-ONLY diff is a suite-selection edit, not authorship → WARN, not BLOCK", () => {
    // Same uncovered EARS-2 and the same declared touched set as the red case
    // above; the only difference is that the file's diff consists of the
    // Feature-level `@host:` line alone (tech spec §6.1). Adding a suite-selection
    // tag must not make the annotating PR inherit the spec's §8 backfill debt.
    const { code, stdout } = runGuard(GUARD, dir("host-tag-only-diff"), {
      env: {
        ...seams("host-tag-only-diff").env,
        LINT_DIFF_CONTENT_DIR: resolve(dir("host-tag-only-diff"), "content"),
      },
    });
    expect(code).toBe(0);
    expect(stdout).toContain(
      "WARN apps/docs/content/specs/features/031-events-feed/031-scenarios.feature",
    );
    expect(stdout).toContain("uncovered handler(s): EARS-2");
  });

  it("green: a Feature-level @host: tag does not cost a handler its coverage", () => {
    const feature = readFileSync(
      resolve(
        dir("green"),
        "apps/docs/content/specs/features/034-course-player/034-scenarios.feature",
      ),
      "utf8",
    );
    // The fixture really does carry the tag the C6 suite selects by, above `Feature:`.
    expect(feature).toContain("@host:both");
    // And the guard still resolves EARS-1/EARS-3 through it: were the `@host:*` line
    // to break the Feature-level tag block, both handlers would read as uncovered and
    // the touched-spec rule would BLOCK.
    const { code, stdout } = runGuard(GUARD, dir("green"), seams("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });
});
