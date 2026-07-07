import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/frontmatter-yaml-lint.ts` (job
 * `frontmatter-yaml`, #597). FS-scan guard: `LINT_FIXTURE_ROOT` (set to the case
 * dir by runGuard) points the `apps/docs/content/**\/*.{md,mdx}` frontmatter scan
 * at a fixture tree. Reproduces the #596 failure class — an unquoted `: ` inside a
 * frontmatter list entry parses as a nested mapping and makes js-yaml throw only
 * when fumadocs compiles the page (a CI red + rerun), which this guard catches
 * at the developer's keyboard via `pnpm pr:preflight --static`.
 */
const GUARD = "frontmatter-yaml-lint.ts";
const dir = (name: string) => caseDir("frontmatter-yaml", name);

describe("frontmatter-yaml", () => {
  it("green: well-formed frontmatter (the `: ` entry is quoted), .md + .mdx → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("parse cleanly");
    // the scan covers both extensions: 1 .md + 1 .mdx in this case.
    expect(stdout).toContain("2 doc(s)");
  });

  it("no-frontmatter: a .md with no `---` block → nothing to parse, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("no-frontmatter"));
    expect(code).toBe(0);
    expect(stdout).toContain("parse cleanly");
  });

  it("red: an unquoted `: ` in a list entry (the #596 class) → exit 1 with file+line", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unquoted-colon"));
    expect(code).toBe(1);
    // file path + a line number the developer can jump to.
    expect(stderr).toContain("900-requirements-en.md");
    expect(stderr).toMatch(/900-requirements-en\.md:\d+/);
  });

  it("red: the same class in a .mdx page (fumadocs compiles both) → exit 1 with file+line", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-mdx"));
    expect(code).toBe(1);
    expect(stderr).toMatch(/page\.mdx:\d+/);
  });
});
