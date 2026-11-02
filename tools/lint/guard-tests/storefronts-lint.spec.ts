import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/storefronts-lint.ts` (#3604).
 *
 * The guard is a TREE check over `apps/docs/content/specs/features/*`: every
 * `surface: user-facing` requirements file (plain, or both halves of a
 * bilingual `-en` / `-ru` pair) declares `storefronts:` — `both`,
 * `academy-only`, `doctor-only` or `none` — and every value but `both` carries a
 * real `storefronts_reason:`. Each case points `LINT_FIXTURE_ROOT` at a mini
 * spec tree and asserts the exit code plus a stable message substring.
 * Engineering-task, so the test ids are `3604:` rather than EARS ids.
 */
const GUARD = "storefronts-lint.ts";
const dir = (name: string) => caseDir("storefronts", name);
const TREE_ONLY = { GITHUB_EVENT_NAME: "push", PR_NUMBER: "" };

describe("storefronts-lint", () => {
  it("3604: green — both / academy-only + reason / none + reason; backend-only and requirements-less folders are not targets → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), { env: TREE_ONLY });
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  it("3604: red — a user-facing spec without `storefronts:` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("201-requirements.md");
    expect(stderr).toContain("no `storefronts:`");
  });

  it("3604: red — a value outside the four forms → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-invalid"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("`storefronts: portal`");
    expect(stderr).toContain("both | academy-only | doctor-only | none");
  });

  it("3604: red — a single-host value without `storefronts_reason:` → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-no-reason"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("203-requirements.md");
    expect(stderr).toContain("needs `storefronts_reason:`");
  });

  it("3604: red — a placeholder reason (TBD) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-placeholder-reason"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("placeholder");
  });

  it("3604: red — the -en and -ru halves disagree → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-en-ru-disagree"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("205-a");
    expect(stderr).toContain("disagree");
  });

  it("3604: red — the -ru half of a bilingual pair has no field → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-ru-missing"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("207-requirements-ru.md");
  });

  it("3604: red — a requirements file without `surface:` fails closed → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-no-surface"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("208-requirements.md");
    expect(stderr).toContain("no `surface:`");
  });

  it("3604: red — a `surface:` value outside the two forms (typo) fails closed → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-bad-surface"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("`surface: user facing`");
    expect(stderr).toContain("backend-only | user-facing");
  });

  it("3604: red — a YAML block-scalar reason is refused → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-block-scalar"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("210-requirements.md");
    expect(stderr).toContain("block scalar");
  });

  it("3604: red — `both` with a reason is a contradiction → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-both-with-reason"), {
      env: TREE_ONLY,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("contradiction");
  });
});
