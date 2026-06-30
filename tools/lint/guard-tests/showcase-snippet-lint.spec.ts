import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/showcase-snippet-lint.ts` (#396).
 *
 * The guard walks `apps/showcase/**` source files and flags a STRING/template
 * literal whose CONTENT depicts block/component usage — a `@ds/design-system`
 * import line or a PascalCase JSX opening tag typed INSIDE quotes — because a
 * hand-typed usage snippet is a second, hand-maintained copy of code the package
 * already owns and DRIFTS (design-system-showcase spec §2.4 "the showcase
 * re-implements nothing"). A real top-of-file import or real rendered JSX (NOT
 * inside quotes) must stay green. Each case ships the minimal `apps/showcase`
 * subtree the guard reads under its `LINT_FIXTURE_ROOT` seam.
 */
const GUARD = "showcase-snippet-lint.ts";
const dir = (name: string) => caseDir("showcase-snippet", name);

describe("showcase-snippet-lint", () => {
  it("green: a real import + real rendered JSX, no snippet string → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a template-literal constant containing `<AuthCard …>` JSX → exit 1, names the file", () => {
    const { code, stderr } = runGuard(GUARD, dir("jsx-snippet"));
    expect(code).toBe(1);
    expect(stderr).toContain("blocks-view.tsx");
    expect(stderr).toContain("AUTO-EXTRACT");
  });

  it("red: a string containing a `from \"@ds/design-system\"` import line → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("import-snippet"));
    expect(code).toBe(1);
    expect(stderr).toContain("@ds/design-system");
  });

  it("green: the same red case but with a `/* showcase-snippet-ok: … */` opt-out → exit 0", () => {
    const { code } = runGuard(GUARD, dir("suppressed"));
    expect(code).toBe(0);
  });
});
