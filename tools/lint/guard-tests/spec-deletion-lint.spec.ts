import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateSpecDeletion,
  isDeletion,
  isRenameOrCopy,
  isRetireablePath,
  parseNameStatus,
  type DiffEntry,
} from "../spec-deletion-lint";
import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Two layers for `tools/lint/spec-deletion-lint.ts` (Issue #971), a WARN guard:
 *
 *   1. PURE unit tests over `evaluateSpecDeletion` + its helpers — the verdict
 *      logic (deletion vs rename, the two escapes) with synthetic inputs, no
 *      subprocess. This is the heart of the guard.
 *   2. Exit-code harness tests spawning the real guard with the diff seam
 *      (`LINT_DIFF_NAMESTATUS_FILE`), the tree seam (`LINT_FIXTURE_ROOT`, set by
 *      runGuard to the case dir), and the gh body seam (`LINT_GH_FIXTURE_DIR`).
 */

const GUARD = "spec-deletion-lint.ts";
const SPEC = "apps/docs/content/specs/features/003-otp/003-requirements.md";
const ADR = "apps/docs/content/adr/0007-ai-stack-design-en.md";
const FEATURE = "apps/docs/content/specs/features/003-otp/003-scenarios.feature";

const D = (path: string): DiffEntry => ({ status: "D", path });
const M = (path: string): DiffEntry => ({ status: "M", path });
const R = (oldPath: string, path: string): DiffEntry => ({
  status: "R100",
  oldPath,
  path,
});

describe("spec-deletion-lint — pure helpers", () => {
  it("isRetireablePath: matches specs/** and adr/** .md/.feature only", () => {
    expect(isRetireablePath(SPEC)).toBe(true);
    expect(isRetireablePath(ADR)).toBe(true);
    expect(isRetireablePath(FEATURE)).toBe(true);
    // Windows-separator input is normalized.
    expect(isRetireablePath(SPEC.replace(/\//g, "\\"))).toBe(true);
    // Not a retireable file:
    expect(isRetireablePath("apps/api/src/otp/otp.service.ts")).toBe(false);
    expect(isRetireablePath("apps/docs/content/product/glossary/x.md")).toBe(
      false,
    );
    expect(isRetireablePath("README.md")).toBe(false);
  });

  it("isDeletion / isRenameOrCopy classify --name-status codes", () => {
    expect(isDeletion("D")).toBe(true);
    expect(isDeletion("M")).toBe(false);
    expect(isRenameOrCopy("R100")).toBe(true);
    expect(isRenameOrCopy("C075")).toBe(true);
    expect(isRenameOrCopy("D")).toBe(false);
  });

  it("parseNameStatus: parses D/M and two-path R lines", () => {
    const entries = parseNameStatus(
      [
        `D\t${SPEC}`,
        `M\t${ADR}`,
        `R100\tapps/docs/content/specs/old.md\tapps/docs/content/specs/new.md`,
      ].join("\n"),
    );
    expect(entries).toEqual([
      { status: "D", path: SPEC },
      { status: "M", path: ADR },
      {
        status: "R100",
        oldPath: "apps/docs/content/specs/old.md",
        path: "apps/docs/content/specs/new.md",
      },
    ]);
  });
});

describe("spec-deletion-lint — evaluateSpecDeletion (pure verdict)", () => {
  it("FIRES: deleting a spec .md with no escape", () => {
    const v = evaluateSpecDeletion([D(SPEC)], [], "no marker here");
    expect(v.ok).toBe(false);
    expect(v.offenders).toContain(SPEC);
    expect(v.escape).toBeNull();
  });

  it("FIRES: deleting an ADR .md", () => {
    expect(evaluateSpecDeletion([D(ADR)], [], "").ok).toBe(false);
  });

  it("FIRES: deleting a .feature file", () => {
    expect(evaluateSpecDeletion([D(FEATURE)], [], "").ok).toBe(false);
  });

  it("PASSES: a pure rename is not a deletion", () => {
    const v = evaluateSpecDeletion(
      [R(SPEC, "apps/docs/content/specs/features/003-otp/003-req.md")],
      [],
      "",
    );
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("PASSES: deletion + `spec-deletion:` body marker → escape=marker", () => {
    const v = evaluateSpecDeletion(
      [D(SPEC)],
      [],
      "Body\n\nspec-deletion: folded into 004; superseded by #999\n",
    );
    expect(v.ok).toBe(true);
    expect(v.escape).toBe("marker");
    // offenders are still reported for the info line.
    expect(v.offenders).toContain(SPEC);
  });

  it("PASSES: deletion + a Superseded transition present → escape=superseded-transition", () => {
    const v = evaluateSpecDeletion([D(SPEC)], [ADR], "no marker");
    expect(v.ok).toBe(true);
    expect(v.escape).toBe("superseded-transition");
  });

  it("PASSES: deleting a non-retireable file (source) never fires", () => {
    const v = evaluateSpecDeletion(
      [D("apps/api/src/otp/otp.service.ts")],
      [],
      "",
    );
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("PASSES: modifying a spec (no deletion) never fires", () => {
    expect(evaluateSpecDeletion([M(SPEC)], [], "").ok).toBe(true);
  });

  it("rejects an EMPTY `spec-deletion:` marker (needs a value)", () => {
    const v = evaluateSpecDeletion([D(SPEC)], [], "spec-deletion:\n");
    expect(v.ok).toBe(false);
  });
});

/** pull_request context wiring the diff + gh seams at a case dir. */
function prEnv(
  prNumber: string,
  name: string,
  opts: { gh?: boolean } = {},
): Record<string, string> {
  const env: Record<string, string> = {
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: prNumber,
    LINT_DIFF_NAMESTATUS_FILE: resolve(
      caseDir("spec-deletion", name),
      "diff-name-status.txt",
    ),
  };
  if (opts.gh !== false) env.LINT_GH_FIXTURE_DIR = ghDir("spec-deletion", name);
  return env;
}

describe("spec-deletion-lint — exit-code harness", () => {
  it("green: a pure rename of a spec → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("spec-deletion", "green-rename"), {
      env: prEnv("101", "green-rename"),
    });
    expect(code).toBe(0);
  });

  it("red: deleting a spec with no marker / no transition → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      caseDir("spec-deletion", "red-bare-deletion"),
      { env: prEnv("102", "red-bare-deletion") },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("DELETED");
  });

  it("green: deletion + `spec-deletion:` body marker → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("spec-deletion", "green-marker"), {
      env: prEnv("103", "green-marker"),
    });
    expect(code).toBe(0);
  });

  it("green: deletion + a modified spec that is now Superseded → exit 0", () => {
    const { code } = runGuard(
      GUARD,
      caseDir("spec-deletion", "green-superseded"),
      { env: prEnv("104", "green-superseded") },
    );
    expect(code).toBe(0);
  });

  it("skip: not a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(
      GUARD,
      caseDir("spec-deletion", "red-bare-deletion"),
      {
        env: {
          GITHUB_EVENT_NAME: "push",
          LINT_DIFF_NAMESTATUS_FILE: resolve(
            caseDir("spec-deletion", "red-bare-deletion"),
            "diff-name-status.txt",
          ),
        },
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});
