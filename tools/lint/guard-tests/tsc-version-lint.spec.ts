import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/tsc-version-lint.ts` (#1258).
 *
 * The guard models the resolution `nest build` actually performs: nest-cli's
 * `TypeScriptBinaryLoader` calls `require.resolve("typescript", { paths: [cwd, ...] })`
 * with cwd = `apps/api`, so the compiler in effect is the one resolved cwd-first from
 * there — NOT a copy vendored inside `@nestjs/cli`. Hence the load-bearing pair of
 * cases: a stale vendored copy alongside a correct api resolution must stay GREEN
 * (the harmless pre-#1258 state), while losing `apps/api`'s own `typescript`
 * dependency — the real re-divergence vector — must be RED.
 *
 * Fixture trees use `node_modules__fixture/` rather than `node_modules/`: a real
 * `node_modules/` inside the repo is git-ignored and could never be committed.
 */
const GUARD = "tsc-version-lint.ts";
const dir = (name: string) => caseDir("tsc-version", name);

// The remedy the red-case output must name: cwd-first resolution from the build dir.
const REMEDY = /resolves cwd-first|cwd-first/;

describe("tsc-version-lint", () => {
  it("green: the build resolves the workspace compiler → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("workspace compiler: typescript@6.0.3");
    expect(stdout).toContain("nest build compiler (cwd-first from apps/api): typescript@6.0.3");
    expect(stdout).toContain("PASS");
  });

  it("green: a stale vendored copy near @nestjs/cli is INFO, never a finding (pre-#1258 state)", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    // The fixture DOES carry @nestjs/cli's own typescript@5.9.3 — the exact shape the
    // first version of this guard flagged red for a non-problem.
    expect(code).toBe(0);
    expect(stdout).toContain("@nestjs/cli vendors typescript@5.9.3");
    expect(stdout).toContain("NOT loaded");
  });

  it("red: the build's cwd-first resolution differs from the workspace compiler → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-build-compiler"));
    expect(code).toBe(1);
    expect(stderr).toContain("build-compiler-mismatch");
    expect(stderr).toContain("typescript@5.9.3");
    expect(stderr).toMatch(REMEDY);
  });

  it("red: apps/api drops its own typescript dependency (the real vector) → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-missing-build-pin"));
    expect(code).toBe(1);
    expect(stderr).toContain("missing-build-pin");
    expect(stderr).toContain("apps/api/package.json declares no `typescript`");
    // Resolution still yields the right VERSION here — only the declaration is gone,
    // so a version comparison alone would pass. That is why the check exists.
    expect(stderr).not.toContain("build-compiler-mismatch");
  });

  it("red: a workspace manifest pinning a different range → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-pin-divergence"));
    expect(code).toBe(1);
    expect(stderr).toContain("pin-divergence");
    expect(stderr).toContain("packages/db/package.json");
  });

  it("green: nothing installed → SKIP the compiler check, exit 0 (never a false red)", () => {
    const { code, stdout } = runGuard(GUARD, dir("skip-not-installed"));
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP");
  });
});
