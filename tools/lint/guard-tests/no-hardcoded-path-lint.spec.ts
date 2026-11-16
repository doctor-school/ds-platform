import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/no-hardcoded-path-lint.ts` (#936). Covers the
 * failure branch (a machine-specific absolute repo-root literal baked into
 * runtime `tools/**` code — the #933 shape) and the two pass paths (a
 * `git rev-parse --show-toplevel`-derived root, and a pure non-path string
 * literal / URL / relative path).
 */
const GUARD = "no-hardcoded-path-lint.ts";
const dir = (name: string) => caseDir("no-hardcoded-path", name);

describe("no-hardcoded-path-lint", () => {
  it("red: a hardcoded absolute drive/repo-root path literal → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-hardcoded-path"));
    expect(code).toBe(1);
    expect(stderr).toContain("hardcoded-abs-path");
  });

  it("green: a git rev-parse --show-toplevel-derived root → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-git-derived"));
    expect(code).toBe(0);
  });

  it("green: pure non-path string literals (URL, relative path) → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-plain-string"));
    expect(code).toBe(0);
  });

  it("green: a `// no-hardcoded-path-ok: <reason>` suppression → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-suppressed"));
    expect(code).toBe(0);
  });

  it("red: a bare `// no-hardcoded-path-ok:` with no reason does NOT suppress → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-empty-reason"));
    expect(code).toBe(1);
    expect(stderr).toContain("hardcoded-abs-path");
  });

  it("green: a regex escape sequence like `\\d:\\d` in a timestamp regex is not a drive root → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green-regex-escape"));
    expect(code).toBe(0);
  });

  it.each(["red-forward-slash", "red-backslash", "red-escaped-string"])(
    "red: drive-root literal (%s) is still flagged → exit 1",
    (name) => {
      const { code, stderr } = runGuard(GUARD, dir(name));
      expect(code).toBe(1);
      expect(stderr).toContain("hardcoded-abs-path");
    },
  );
});
