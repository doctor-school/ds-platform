import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATALOG_DELETION_MARKER_RE,
  evaluateCatalogDeletion,
  isCatalogPath,
  markerFromEnv,
} from "../catalog-deletion-lint";
import { type DiffEntry } from "../spec-deletion-lint";
import { caseDir, ghDir, REPO_ROOT, runGuard } from "./run-guard";

/**
 * Two layers for `tools/lint/catalog-deletion-lint.ts` (Issue #1261):
 *
 *   1. PURE unit tests over `evaluateCatalogDeletion` + `markerFromEnv` — the
 *      verdict logic (deletion vs rename, the marker escape) with synthetic
 *      inputs, no subprocess.
 *   2. Exit-code harness tests spawning the real guard in BOTH modes with the
 *      diff seam (`LINT_DIFF_NAMESTATUS_FILE`) and the gh body seam
 *      (`LINT_GH_FIXTURE_DIR`): the guard must FIRE on a synthetic
 *      catalog-deleting diff and stay SILENT otherwise.
 */

const GUARD = "catalog-deletion-lint.ts";
const SKILL = "apps/docs/content/skills/do-feature-iteration/SKILL.md";
const OTHER_SKILL = "apps/docs/content/skills/merge-when-green/SKILL.md";

const D = (path: string): DiffEntry => ({ status: "D", path });
const M = (path: string): DiffEntry => ({ status: "M", path });
const R = (oldPath: string, path: string): DiffEntry => ({
  status: "R100",
  oldPath,
  path,
});

const diff = (name: string) => resolve(caseDir("catalog-deletion", name), "diff.txt");

describe("catalog-deletion-lint — pure helpers", () => {
  it("isCatalogPath: matches the skill catalog tree only", () => {
    expect(isCatalogPath(SKILL)).toBe(true);
    // Windows-separator input is normalized.
    expect(isCatalogPath(SKILL.replace(/\//g, "\\"))).toBe(true);
    expect(isCatalogPath("apps/docs/content/skills/x/reference/notes.md")).toBe(
      true,
    );
    // Not the catalog:
    expect(isCatalogPath("apps/docs/content/specs/features/003-otp/003-design.md")).toBe(false);
    expect(isCatalogPath(".agents/skills/do-feature-iteration/SKILL.md")).toBe(false);
    expect(isCatalogPath("apps/docs/content/skills")).toBe(false);
  });

  it("markerFromEnv normalises a pre-commit reason into marker form", () => {
    expect(CATALOG_DELETION_MARKER_RE.test(markerFromEnv("folded into #1261"))).toBe(true);
    expect(markerFromEnv("")).toBe("");
    expect(markerFromEnv("   ")).toBe("");
    expect(markerFromEnv(undefined)).toBe("");
    // Newlines cannot be smuggled in to fake a multi-line body.
    expect(markerFromEnv("a\nb")).toBe("catalog-deletion: a b");
  });
});

describe("catalog-deletion-lint — evaluateCatalogDeletion (pure verdict)", () => {
  it("FLAGS a bare catalog deletion", () => {
    const v = evaluateCatalogDeletion([D(SKILL), M("README.md")], "");
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual([SKILL]);
    expect(v.escape).toBeNull();
  });

  it("FLAGS a mass deletion and names every offender", () => {
    const v = evaluateCatalogDeletion([D(SKILL), D(OTHER_SKILL)], "");
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual([SKILL, OTHER_SKILL]);
  });

  it("PASSES a pure rename of a skill file", () => {
    const v = evaluateCatalogDeletion([R(SKILL, OTHER_SKILL)], "");
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("PASSES a diff that touches no catalog file", () => {
    const v = evaluateCatalogDeletion(
      [D("apps/api/src/otp/otp.service.ts"), M("README.md")],
      "",
    );
    expect(v.ok).toBe(true);
  });

  it("PASSES: deletion + `catalog-deletion:` marker → escape=marker", () => {
    const v = evaluateCatalogDeletion(
      [D(SKILL)],
      "Body\n\ncatalog-deletion: skill folded into do-hotfix-pr (#1261)\n",
    );
    expect(v.ok).toBe(true);
    expect(v.escape).toBe("marker");
    expect(v.offenders).toEqual([SKILL]);
  });

  it("rejects an EMPTY `catalog-deletion:` marker (needs a value)", () => {
    expect(evaluateCatalogDeletion([D(SKILL)], "catalog-deletion:\n").ok).toBe(false);
  });

  it("a one-line PR body without the marker never sanctions", () => {
    expect(evaluateCatalogDeletion([D(SKILL)], "Closes #1261").ok).toBe(false);
  });
});

describe("catalog-deletion-lint — pre-commit hook wiring (#1266 review BLOCKER)", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
  ) as { "simple-git-hooks": { "pre-commit": string } };
  const hook = pkg["simple-git-hooks"]["pre-commit"];

  /**
   * `.git/hooks` is SHARED by the main clone and every linked worktree, and any
   * `pnpm install` (mandatory in a worktree, AGENTS.md §6) rewrites it from the
   * CHECKED-OUT branch's package.json. An ungated `pnpm lint:catalog-deletion`
   * line therefore installs repo-wide and hard-fails every commit on any branch
   * that predates this guard (`ERR_PNPM_NO_SCRIPT`) — it blocked a concurrent
   * session during #1261. The invocation must be gated on the guard file being
   * present on the checked-out branch.
   */
  it("gates the guard invocation on the guard file existing (POSIX `test`)", () => {
    expect(hook).toContain("[ -f tools/lint/catalog-deletion-lint.ts ]");
    expect(hook).toContain("pnpm lint:catalog-deletion --staged");
  });

  /**
   * The gate must not swallow the guard's exit code: an `X && guard || true`
   * shape turns a BLOCK into a no-op whenever the guard actually fires. Only the
   * `if … then … fi` form keeps the failure propagating.
   */
  it("keeps the guard BLOCKing where it exists (no `|| true` swallow)", () => {
    expect(hook).not.toMatch(/\|\|\s*true/);
    expect(hook).toMatch(
      /if \[ -f tools\/lint\/catalog-deletion-lint\.ts \]; then pnpm lint:catalog-deletion --staged; fi/,
    );
  });
});

describe("catalog-deletion-lint — exit-code harness (pre-commit mode)", () => {
  it("red: staged catalog deletion, no reason → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("catalog-deletion", "red-bare-deletion"), {
      extraArgs: ["--staged"],
      env: {
        LINT_DIFF_NAMESTATUS_FILE: diff("red-bare-deletion"),
        CATALOG_DELETION: "",
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("deleted skill-catalog file");
  });

  it("green: staged catalog deletion + CATALOG_DELETION reason → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("catalog-deletion", "red-bare-deletion"), {
      extraArgs: ["--staged"],
      env: {
        LINT_DIFF_NAMESTATUS_FILE: diff("red-bare-deletion"),
        CATALOG_DELETION: "retiring the dead skill, see #1261",
      },
    });
    expect(code).toBe(0);
  });

  it("green: staged rename of a skill file → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("catalog-deletion", "green-rename"), {
      extraArgs: ["--staged"],
      env: {
        LINT_DIFF_NAMESTATUS_FILE: diff("green-rename"),
        CATALOG_DELETION: "",
      },
    });
    expect(code).toBe(0);
  });
});

describe("catalog-deletion-lint — exit-code harness (PR mode)", () => {
  const prEnv = (name: string, extra: Record<string, string> = {}) => ({
    LINT_DIFF_NAMESTATUS_FILE: diff(name),
    GITHUB_EVENT_NAME: "pull_request",
    PR_NUMBER: "104",
    LINT_GH_FIXTURE_DIR: ghDir("catalog-deletion", name),
    CATALOG_DELETION: "",
    ...extra,
  });

  it("red: PR deletes catalog files, body has no marker → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, caseDir("catalog-deletion", "red-bare-deletion"), {
      env: prEnv("red-bare-deletion"),
    });
    expect(code).toBe(1);
    expect(stderr).toContain("skill-catalog file(s) DELETED");
  });

  it("green: PR body carries the `catalog-deletion:` marker → exit 0", () => {
    const { code } = runGuard(GUARD, caseDir("catalog-deletion", "green-marker"), {
      env: prEnv("green-marker"),
    });
    expect(code).toBe(0);
  });

  it("skips outside a pull_request event → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, caseDir("catalog-deletion", "red-bare-deletion"), {
      env: prEnv("red-bare-deletion", { GITHUB_EVENT_NAME: "push" }),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });
});
