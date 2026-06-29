import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/ears-naming-lint.ts` (#316, the FORMAT-hygiene
 * direction of the bidirectional EARS↔test contract). The guard flags a title that
 * *attempts* the EARS prefix but breaks the canonical `EARS-N:` shape — it does NOT
 * demand every test be EARS-named (a legit non-EARS unit / `#issue` test is left
 * alone; the coverage direction is `ears-test-lint`). The green case proves the real
 * corpus shapes pass (flat / nested / compound `EARS-N/M:` / `EARS-N (#issue):`,
 * plus `#issue:` and plain unit titles). The comment-mask case proves a malformed
 * example living only in a comment is not a false positive.
 */
const GUARD = "ears-naming-lint.ts";
const dir = (name: string) => caseDir("ears-naming", name);

describe("ears-naming-lint", () => {
  it("green: canonical + compound + annotated EARS, plus legit non-EARS titles → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red-lowercase: `ears-3:` is a malformed EARS attempt → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-lowercase"));
    expect(code).toBe(1);
    expect(stderr).toContain("malformed EARS test-name");
  });

  it("red-no-hyphen: `EARS3:` is a malformed EARS attempt → exit 1", () => {
    const { code } = runGuard(GUARD, dir("red-no-hyphen"));
    expect(code).toBe(1);
  });

  it("red-no-colon: `EARS-3 ` without a colon is a malformed EARS attempt → exit 1", () => {
    const { code } = runGuard(GUARD, dir("red-no-colon"));
    expect(code).toBe(1);
  });

  it("suppressed: a reasoned `ears-naming-ok` marker skips an offending file → exit 0", () => {
    const { code } = runGuard(GUARD, dir("suppressed"));
    expect(code).toBe(0);
  });

  it("comment-mask: a malformed example only in a comment — no false positive → exit 0", () => {
    const { code } = runGuard(GUARD, dir("comment-mask"));
    expect(code).toBe(0);
  });
});
