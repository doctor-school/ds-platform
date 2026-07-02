import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/glossary-roundtrip-lint.ts` (job
 * `glossary-roundtrip`, #448). FS-scan guard: `LINT_FIXTURE_ROOT` points the
 * glossary-source read + generated-ids.ts parse at a fixture tree.
 */
const GUARD = "glossary-roundtrip-lint.ts";
const dir = (name: string) => caseDir("glossary-roundtrip", name);

describe("glossary-roundtrip", () => {
  it("empty: no generated ids.ts artifact → nothing to roundtrip, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("no-artifact"));
    expect(code).toBe(0);
    expect(stdout).toContain("nothing to roundtrip");
  });

  it("green: source ids and generated ids in lockstep → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("in lockstep");
  });

  it("red: a source id missing from the generated artifact → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-generated"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing from generated");
    expect(stderr).toContain("bar");
  });

  it("red: an orphan generated id with no source term → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-orphan-generated"));
    expect(code).toBe(1);
    expect(stderr).toContain("orphan generated id");
    expect(stderr).toContain("baz");
  });
});
