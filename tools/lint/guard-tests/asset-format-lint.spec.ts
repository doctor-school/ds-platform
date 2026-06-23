import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/asset-format-lint.ts` (#286). Covers the
 * green path (only SVG/WEBP under apps/<app>/public) and both disallowed-raster
 * branches (a .png, a .jpg).
 *
 * LIMITATION: the guard's ALLOW allowlist keys on FIXED production-relative
 * paths (`apps/<app>/public/...`). Under a fixture root those keys never match a
 * fixture's relative path, so the allowlist-exception branch cannot be exercised
 * through this seam without hardcoding production paths into a fixture — left
 * uncovered by design. The allowlist is empty in production today.
 */
const GUARD = "asset-format-lint.ts";
const dir = (name: string) => caseDir("asset-format", name);

describe("asset-format-lint", () => {
  it("green: only SVG + WEBP under apps/<app>/public → exit 0", () => {
    const { code } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
  });

  it("red: a committed .png under public → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-png"));
    expect(code).toBe(1);
    expect(stderr).toContain("disallowed raster");
    expect(stderr).toContain("wordmark.png");
  });

  it("red: a committed .jpg under public → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-jpg"));
    expect(code).toBe(1);
    expect(stderr).toContain("disallowed raster");
    expect(stderr).toContain("photo.jpg");
  });
});
