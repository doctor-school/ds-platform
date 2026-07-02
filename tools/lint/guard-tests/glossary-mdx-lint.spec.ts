import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/glossary-mdx-lint.ts` (job `glossary-mdx`,
 * #448). FS-scan guard: `LINT_FIXTURE_ROOT` points the glossary-source read +
 * docs/MDX directive scan at a fixture tree. Covers the three scoping seams that
 * keep the `[[…]]` namespace overload from producing false positives:
 * cross-ref-namespace exclusion + code-span masking + the new-term opt-out.
 */
const GUARD = "glossary-mdx-lint.ts";
const dir = (name: string) => caseDir("glossary-mdx", name);

describe("glossary-mdx", () => {
  it("green: a directive that resolves to a glossary term → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-resolved"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("green: memory/decision `[[reference_*]]`/`[[feedback_*]]`/`[[project_*]]` cross-refs are ignored → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-crossref"));
    expect(code).toBe(0);
    // All directives fall in the excluded cross-ref namespace → none counted.
    expect(stdout).toContain("0 glossary directive(s)");
  });

  it("green: `[[…]]` inside inline code + fenced blocks is masked out → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-codespan"));
    expect(code).toBe(0);
    expect(stdout).toContain("0 glossary directive(s)");
  });

  it("green: an unknown term with a same-line `new-term:` opt-out → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-newterm"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("red: an unresolved directive with no opt-out → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unresolved"));
    expect(code).toBe(1);
    expect(stderr).toContain("bogus_term");
    expect(stderr).toContain("does not resolve");
  });
});
