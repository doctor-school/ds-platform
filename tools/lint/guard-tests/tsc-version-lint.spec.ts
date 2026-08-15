import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/tsc-version-lint.ts` (#1258). `apps/api` builds
 * with `nest build`, and `@nestjs/cli` vendors its own `typescript` — so the prod
 * artifact could be emitted by a compiler `pnpm typecheck` never runs (observed
 * 2026-08-14: emit on 5.9.3, typecheck on 6.0.3). The guard fails on:
 *
 *   1. compiler-mismatch — a build-toolchain package resolves a `typescript`
 *      whose version differs from the workspace root's resolved compiler
 *   2. pin-divergence — a workspace manifest declares a different `typescript`
 *      range than the root manifest
 *
 * Fixture cases lay out `package.json` + `node_modules__fixture/**` trees (the
 * fixture modules-dir name — a real `node_modules/` inside the repo is git-ignored
 * and could never be committed).
 */
const GUARD = "tsc-version-lint.ts";
const dir = (name: string) => caseDir("tsc-version", name);

// The remedy the red-case output must name (Issue #1258 AC: a future re-divergence
// is surfaced with the fix, not left silent).
const REMEDY = /pnpm\.overrides\.typescript/;

describe("tsc-version-lint", () => {
  it("green: nested toolchain compiler equals the workspace compiler → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("workspace compiler: typescript@6.0.3");
    expect(stdout).toContain("PASS");
  });

  it("green: the nested-under-@nestjs/cli packages are reached via their parent", () => {
    const { stdout } = runGuard(GUARD, dir("green"));
    // @nestjs/schematics is not resolvable from apps/api — only from @nestjs/cli.
    expect(stdout).toContain("@nestjs/schematics");
    expect(stdout).toContain("2 build-toolchain package(s) checked from apps/api");
  });

  it("red: nest-cli's nested typescript differs from the workspace one → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-compiler-mismatch"));
    expect(code).toBe(1);
    expect(stderr).toContain("compiler-mismatch");
    expect(stderr).toContain("typescript@5.9.3");
    expect(stderr).toContain("@nestjs/cli");
    expect(stderr).toMatch(REMEDY);
  });

  it("red: a workspace manifest pinning a different range → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-pin-divergence"));
    expect(code).toBe(1);
    expect(stderr).toContain("pin-divergence");
    expect(stderr).toContain("packages/db/package.json");
    expect(stderr).toMatch(REMEDY);
  });

  it("green: nothing installed → SKIP the compiler check, exit 0 (never a false red)", () => {
    const { code, stdout } = runGuard(GUARD, dir("skip-not-installed"));
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP");
  });
});
