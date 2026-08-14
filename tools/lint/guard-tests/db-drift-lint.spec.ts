import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/db-drift-lint.ts` (#1236). The guard is the
 * ADR-0006 §7 "DB drift" row: a schema edit shipped without its generated
 * migration types a column no database has, which nothing else in the pipeline
 * can see (typecheck, unit, and e2e all run against the SAME stale chain) — it
 * surfaces only as a prod runtime error. It fails on:
 *
 *   1. unlisted table file — a `packages/db/src/schema/*.ts` declaring a
 *      `pgTable(` that is absent from the `schema:` array of
 *      `packages/db/drizzle.config.ts`, hence invisible to drizzle-kit
 *   2. generate-failed    — `drizzle-kit generate` did not complete (non-zero,
 *      spawn error, or killed by the timeout on its interactive prompt)
 *   3. drift-detected     — regenerating dirtied paths under `apps/api/drizzle/`
 *
 * and SKIPs (exit 0) when the config or the committed migration dir is absent.
 *
 * In fixture mode (`LINT_FIXTURE_ROOT`) both subprocess boundaries are read
 * from files instead of spawned — `<root>/generate.json` for the generate
 * outcome, `<root>/git-status/{before,after}.txt` for the porcelain — so every
 * branch is drivable without git or drizzle-kit.
 */
const GUARD = "db-drift-lint.ts";
const dir = (name: string) => caseDir("db-drift", name);

// The remedy every drift-class red must name (Issue #1236 AC).
const REMEDY = /drizzle:generate/;

describe("db-drift-lint", () => {
  it("green: schema listed in the config, nothing dirty after generate → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("schema-coverage OK");
  });

  it("green: a non-table helper file is exempt from the config list", () => {
    // The `green` case ships `enums.ts` (a `pgEnum`, no `pgTable(`) alongside
    // the listed `users.ts`. Demanding it in `schema:` would be a false red.
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("1 table file(s)");
  });

  it("green: pre-existing local dirt is ignored, not reported as drift → exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green-preexisting-dirt"));
    expect(code).toBe(0);
    expect(stdout).toContain("pre-existing dirty path(s)");
    expect(stdout).toContain("PASS");
  });

  it("red: a table file missing from drizzle.config.ts `schema:` → exit 1", () => {
    // The false NEGATIVE this check closes: drizzle-kit diffs only the listed
    // files, so an unlisted new table produces no migration and the tree stays
    // clean — drift-detection alone would call that green.
    const { code, stderr } = runGuard(GUARD, dir("red-unlisted-table-file"));
    expect(code).toBe(1);
    expect(stderr).toContain("webinars.ts");
    expect(stderr).toContain("drizzle.config.ts");
    expect(stderr).toMatch(REMEDY);
    // The non-table helper must not be dragged in with it.
    expect(stderr).not.toContain("enums.ts");
  });

  it("red: regenerating dirties the committed migration dir → exit 1 + remedy", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-drift"));
    expect(code).toBe(1);
    expect(stderr).toContain("have drifted");
    expect(stderr).toContain("0015_rainy_proteus.sql");
    expect(stderr).toMatch(REMEDY);
  });

  it("red: `generate` killed by the timeout (the interactive prompt) → exit 1, fails closed", () => {
    // status === null + a signal is what spawnSync reports on the timeout kill.
    // This branch must be RED, never a silent green.
    const { code, stderr } = runGuard(GUARD, dir("red-generate-failed"));
    expect(code).toBe(1);
    expect(stderr).toContain("did not complete");
    expect(stderr).toContain("rename-vs-drop prompt");
  });

  it("green: no drizzle config → SKIP, exit 0 (never a false red)", () => {
    const { code, stdout } = runGuard(GUARD, dir("skip-no-config"));
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP");
  });

  it("green: no committed migration dir → SKIP, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("skip-no-out-dir"));
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP");
  });
});
