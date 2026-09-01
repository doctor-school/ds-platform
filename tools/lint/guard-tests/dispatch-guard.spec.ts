import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The hook is plain ESM JS (runs under bare `node` from settings.json), so the
// spec imports its pure seams directly — same pattern as the read-guard spec.
import {
  CARVE_OUT_ENV,
  DISPATCH_WARN_THRESHOLD,
  GUARD_STATE_DIR_REL,
  decideDispatch,
  inWorktree,
  isCarveOut,
  readStreak,
  readWarned,
  stateFilePath,
  warnMessage,
  writeStreak,
} from "../../hooks/dispatch-guard.mjs";

/**
 * Unit cover for the #913 dispatch guard: a PreToolUse hook that counts
 * CONSECUTIVE lead-authored Edit/Write/MultiEdit calls in the SHARED main tree
 * with no intervening Agent dispatch, and WARNs (never blocks) once the streak
 * reaches DISPATCH_WARN_THRESHOLD — naming AGENTS.md §6 orchestration-default.
 *
 * Paths are derived from `os.tmpdir()` + `path.resolve`/`join` so the spec runs
 * identically on Windows and the Linux CI runner. State is injected — the pure
 * seams are exercised without touching a real `.claude/` state file.
 */

const ROOT = resolve(tmpdir(), "fake-ds-root");
const WORKTREE = join(ROOT, ".claude", "worktrees", "913");

/** Drive N consecutive mutations through the pure seam, threading the streak,
 * and return the action of each step. */
function runStreak(
  count: number,
  over: Record<string, unknown> = {},
): string[] {
  let streak = 0;
  const actions: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = decideDispatch({
      toolName: "Edit",
      cwd: ROOT,
      projectDir: ROOT,
      streak,
      ...over,
    });
    actions.push(d.action);
    if (typeof d.streak === "number") streak = d.streak;
  }
  return actions;
}

describe("dispatch-guard decideDispatch() — counting + threshold", () => {
  it("3 consecutive main-tree mutations → WARN on the 3rd (default N=3)", () => {
    expect(DISPATCH_WARN_THRESHOLD).toBe(3);
    expect(runStreak(3)).toEqual(["count", "count", "warn"]);
  });

  it("keeps warning on every further mutation past the threshold", () => {
    expect(runStreak(5)).toEqual(["count", "count", "warn", "warn", "warn"]);
  });

  it("stays silent below the threshold", () => {
    expect(runStreak(2)).toEqual(["count", "count"]);
  });

  it("an Agent dispatch resets the streak to 0", () => {
    const d = decideDispatch({
      toolName: "Agent",
      cwd: ROOT,
      projectDir: ROOT,
      streak: 2,
    });
    expect(d.action).toBe("reset");
    expect(d.streak).toBe(0);
  });

  it("Task is accepted as the cross-harness dispatch alias", () => {
    expect(
      decideDispatch({
        toolName: "Task",
        cwd: ROOT,
        projectDir: ROOT,
        streak: 2,
      }).action,
    ).toBe("reset");
  });

  it("Codex spawn_agent resets and apply_patch counts", () => {
    expect(
      decideDispatch({
        toolName: "spawn_agent",
        cwd: ROOT,
        projectDir: ROOT,
        streak: 2,
      }),
    ).toEqual({ action: "reset", streak: 0 });
    expect(
      decideDispatch({
        toolName: "apply_patch",
        cwd: ROOT,
        projectDir: ROOT,
        streak: 2,
      }),
    ).toEqual({ action: "warn", streak: 3 });
  });

  it("an intervening Agent resets so the count restarts (no false warn)", () => {
    // Edit, Edit, Agent(reset), Edit, Edit → highest streak reached is 2.
    let streak = 0;
    const seq = ["Edit", "Edit", "Agent", "Edit", "Edit"];
    const actions = seq.map((toolName) => {
      const d = decideDispatch({
        toolName,
        cwd: ROOT,
        projectDir: ROOT,
        streak,
      });
      if (typeof d.streak === "number") streak = d.streak;
      return d.action;
    });
    expect(actions).toEqual(["count", "count", "reset", "count", "count"]);
    expect(actions).not.toContain("warn");
  });

  it("a non-mutation, non-dispatch tool is a no-op that neither counts nor resets", () => {
    const d = decideDispatch({
      toolName: "Bash",
      cwd: ROOT,
      projectDir: ROOT,
      streak: 2,
    });
    expect(d.action).toBe("silent");
    expect(d.streak).toBeUndefined();
  });
});

describe("dispatch-guard decideDispatch() — carve-outs", () => {
  it("read-only / recon session never warns (no mutations → streak stays 0)", () => {
    // A session that only reads never invokes decideDispatch with a mutation;
    // dispatch/other tools produce reset/silent, never warn.
    expect(
      decideDispatch({
        toolName: "Read",
        cwd: ROOT,
        projectDir: ROOT,
        streak: 0,
      }).action,
    ).toBe("silent");
  });

  it("a worktree-isolated session (subagent executor) is never warned", () => {
    expect(runStreak(5, { cwd: WORKTREE })).toEqual(Array(5).fill("silent"));
  });

  it("a session born in a worktree (projectDir under worktrees) is silent", () => {
    expect(runStreak(5, { projectDir: WORKTREE, cwd: WORKTREE })).toEqual(
      Array(5).fill("silent"),
    );
  });

  it("the explicit sanctioned-inline opt-out silences the guard", () => {
    expect(runStreak(5, { carveOut: true })).toEqual(Array(5).fill("silent"));
  });

  it("a custom threshold is honored", () => {
    expect(runStreak(2, { threshold: 2 })).toEqual(["count", "warn"]);
  });
});

describe("dispatch-guard warnMessage()", () => {
  it("names AGENTS.md §6 orchestration-default and the sanctioned inline carve-outs", () => {
    const msg = warnMessage(3);
    expect(msg).toContain("AGENTS.md §6");
    expect(msg).toMatch(/orchestration/i);
    expect(msg).toMatch(/sanctioned inline/i);
    expect(msg).toContain("#913");
  });

  it("states it is WARN-level and never blocks (Phase 0)", () => {
    const msg = warnMessage(4);
    expect(msg).toMatch(/WARN-level/);
    expect(msg).toMatch(/never blocks/i);
  });
});

describe("dispatch-guard carve-out + worktree seams", () => {
  it("isCarveOut recognizes the documented truthy env values", () => {
    for (const v of ["1", "true", "yes"]) {
      expect(isCarveOut({ [CARVE_OUT_ENV]: v })).toBe(true);
    }
    expect(isCarveOut({})).toBe(false);
    expect(isCarveOut({ [CARVE_OUT_ENV]: "0" })).toBe(false);
  });

  it("inWorktree matches the worktree root and its children, not the main root", () => {
    expect(inWorktree(WORKTREE)).toBe(true);
    expect(inWorktree(join(WORKTREE, "tools"))).toBe(true);
    expect(inWorktree(ROOT)).toBe(false);
  });

  it("inWorktree normalizes backslash separators (Windows payloads)", () => {
    expect(inWorktree("X:\\repo\\.claude\\worktrees\\913")).toBe(true);
    expect(inWorktree("X:\\repo")).toBe(false);
  });
});

describe("dispatch-guard state seam", () => {
  it("stateFilePath sanitizes the session id and lives under the gitignored dir", () => {
    const p = stateFilePath(ROOT, "sess/../evil id");
    expect(p).toBe(
      join(ROOT, ...GUARD_STATE_DIR_REL.split("/"), "sess_.._evil_id.json"),
    );
  });

  it("readStreak fails open to 0 on a missing/corrupt file", () => {
    const bad = () => {
      throw new Error("ENOENT");
    };
    expect(readStreak("nope", bad)).toBe(0);
    expect(readStreak("bad", () => "{not json")).toBe(0);
  });

  it("readStreak coerces a negative/non-numeric streak to 0", () => {
    expect(readStreak("x", () => JSON.stringify({ streak: -4 }))).toBe(0);
    expect(readStreak("x", () => JSON.stringify({ streak: "3" }))).toBe(0);
    expect(readStreak("x", () => JSON.stringify({ streak: 4 }))).toBe(4);
  });

  it("writeStreak mkdirs the parent then writes JSON (injected FS)", () => {
    const calls: Array<[string, string]> = [];
    const mkdirs: string[] = [];
    writeStreak(join(ROOT, ".claude", "dispatch-guard-state", "s.json"), 2, {
      mkdir: (d: string) => mkdirs.push(d),
      writeFile: (p: string, c: string) => calls.push([p, c]),
    });
    expect(mkdirs).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1])).toEqual({ streak: 2 });
  });

  it("writeStreak swallows FS errors (fail-open, never throws)", () => {
    expect(() =>
      writeStreak("x", 1, {
        mkdir: () => {
          throw new Error("EACCES");
        },
        writeFile: () => undefined,
      }),
    ).not.toThrow();
  });

  it("writeStreak persists the warned latch when it is supplied", () => {
    const calls: Array<[string, string]> = [];
    writeStreak(
      join(ROOT, ".claude", "dispatch-guard-state", "s.json"),
      3,
      { mkdir: () => undefined, writeFile: (p, c) => calls.push([p, c]) },
      true,
    );
    expect(JSON.parse(calls[0][1])).toEqual({ streak: 3, warned: true });
  });

  it("readWarned fails open to false on missing/corrupt/absent-field state", () => {
    expect(
      readWarned("nope", () => {
        throw new Error("ENOENT");
      }),
    ).toBe(false);
    expect(readWarned("bad", () => "{not json")).toBe(false);
    expect(readWarned("x", () => JSON.stringify({ streak: 4 }))).toBe(false);
    expect(
      readWarned("x", () => JSON.stringify({ streak: 4, warned: true })),
    ).toBe(true);
  });
});

/**
 * #1700 latch: the guard says "you are drifting inline" ONCE per session. The
 * week-long transcript audit (2026-08-25..09-01) found this guard the second-
 * loudest hook with zero blocks — the repeat WARNs were noise, not enforcement.
 * Counting is deliberately untouched: the streak still advances and still
 * RESETS on an Agent dispatch, so the state stays truthful for the retro.
 */
describe("dispatch-guard decideDispatch() — once-per-session WARN latch (#1700)", () => {
  const mutate = (streak: number, warned: boolean) =>
    decideDispatch({
      toolName: "Edit",
      cwd: ROOT,
      projectDir: ROOT,
      streak,
      warned,
    });

  it("warns on the first threshold crossing", () => {
    expect(mutate(DISPATCH_WARN_THRESHOLD - 1, false)).toEqual({
      action: "warn",
      streak: DISPATCH_WARN_THRESHOLD,
    });
  });

  it("stays silent on every later crossing once latched — but keeps counting", () => {
    const d = mutate(DISPATCH_WARN_THRESHOLD + 4, true);
    expect(d.action).toBe("count");
    expect(d.streak).toBe(DISPATCH_WARN_THRESHOLD + 5);
  });

  it("a whole latched run of mutations emits exactly one warn", () => {
    let streak = 0;
    let warned = false;
    const actions = Array.from({ length: 12 }, () => {
      const d = mutate(streak, warned);
      streak = d.streak as number;
      if (d.action === "warn") warned = true;
      return d.action;
    });
    expect(actions.filter((a) => a === "warn")).toHaveLength(1);
    expect(streak).toBe(12);
  });

  it("defaults to unlatched when `warned` is omitted (back-compat)", () => {
    expect(
      decideDispatch({
        toolName: "Edit",
        cwd: ROOT,
        projectDir: ROOT,
        streak: DISPATCH_WARN_THRESHOLD - 1,
      }).action,
    ).toBe("warn");
  });
});
