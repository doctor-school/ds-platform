import { describe, expect, it } from "vitest";

import { caseDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/events-lint.ts` (job `events-drift`, #448).
 * FS-scan guard: `LINT_FIXTURE_ROOT` (set to the case dir by runGuard) points the
 * @OutboxEmit-emitter scan and the events.md manifest scan at a fixture tree.
 */
const GUARD = "events-lint.ts";
const dir = (name: string) => caseDir("events-drift", name);

describe("events-drift", () => {
  it("empty: no emitters and no events.md → nothing to check, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("empty"));
    expect(code).toBe(0);
    expect(stdout).toContain("no event contract inputs");
  });

  it("green: emitted event is documented in the manifest → in lockstep, exit 0", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"));
    expect(code).toBe(0);
    expect(stdout).toContain("in lockstep");
  });

  it("red: an emitter with no documenting manifest → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-undocumented"));
    expect(code).toBe(1);
    expect(stderr).toContain("undocumented event");
    expect(stderr).toContain("user.registered");
  });

  it("red: a documented event with no emitter → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-unemitted"));
    expect(code).toBe(1);
    expect(stderr).toContain("unemitted event");
    expect(stderr).toContain("user.registered");
  });
});
