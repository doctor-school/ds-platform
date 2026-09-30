import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractNote,
  firstMarkerLine,
  rawSectionBody,
} from "../../ci/post-product-note.mjs";

import { caseDir, ghDir, REPO_ROOT, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/product-note-boundary-lint.ts` (Issue #2489):
 * the Product note section must hold no machine-marker (evidence) line. Bodies
 * come from saved fixtures via `--body-file`, plus one PR-context run through the
 * `LINT_GH_FIXTURE_DIR` seam (lib/gh.ts).
 */
const GUARD = "product-note-boundary-lint.ts";
const LINT_DIR = resolve(REPO_ROOT, "tools", "lint");
const FIX = caseDir("product-note-boundary", "");
const body = (name: string): string => resolve(FIX, name);

describe("product-note-boundary-lint", () => {
  it("2489: the #2451-shaped body (evidence under the note) → exit 1, names the first marker line", () => {
    const { code, stderr } = runGuard(GUARD, FIX, {
      extraArgs: ["--body-file", body("pr-2451-body.md")],
    });
    expect(code).toBe(1);
    expect(stderr).toContain("registry-research: adopted");
    expect(stderr).toContain("## Delivery evidence");
  });

  it("2489: a template-shaped body (note, then `## Linked`) → exit 0", () => {
    const { code } = runGuard(GUARD, FIX, {
      extraArgs: ["--body-file", body("template-body.md")],
    });
    expect(code).toBe(0);
  });

  it("2489: a RU note with in-sentence colons → exit 0", () => {
    const { code } = runGuard(GUARD, FIX, {
      extraArgs: ["--body-file", body("ru-colon-body.md")],
    });
    expect(code).toBe(0);
  });

  it("2489: a `none` note → exit 0 (nothing is delivered)", () => {
    const { code } = runGuard(GUARD, FIX, {
      extraArgs: ["--body-file", body("none-body.md")],
    });
    expect(code).toBe(0);
  });

  it("2489: PR context — the live-PR path reads the body via gh and fails on leaked evidence", () => {
    const { code, stderr } = runGuard(GUARD, FIX, {
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        PR_NUMBER: "2451",
        LINT_GH_FIXTURE_DIR: ghDir("product-note-boundary", "leaked-evidence"),
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("PR #2451");
  });

  it("2489: not a pull_request event and no --body-file → exit 0 skip", () => {
    const { code, stdout } = runGuard(GUARD, FIX, {
      env: { GITHUB_EVENT_NAME: "push" },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a pull_request event");
  });

  it("2489: the guard and the product-note lint import the shared seam — no local section regex", () => {
    for (const file of [GUARD, "product-note-lint.ts"]) {
      const src = readFileSync(resolve(LINT_DIR, file), "utf8");
      expect(src).toMatch(/from\s*["']\.\.\/ci\/post-product-note\.mjs["']/);
      expect(src).not.toMatch(/product\s\+note/);
      expect(src).not.toMatch(/function\s+(sectionBody|extractNote)\b/);
    }
  });

  it("2489: the raw section still sees the evidence the delivery cut removes", () => {
    const b = readFileSync(body("pr-2451-body.md"), "utf8");
    expect(firstMarkerLine(rawSectionBody(b))).toMatch(/^registry-research:/);
    expect(extractNote(b)).not.toMatch(/registry-research|Stage-B|https?:/);
  });
});
