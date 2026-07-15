import { describe, expect, it } from "vitest";

import { mergeWhenGreen, shouldMerge } from "../../gh/merge-when-green.mjs";

/**
 * merge-when-green — unit cover for `tools/gh/merge-when-green.mjs`'s pure seams
 * (#928).
 *
 * The wrapper makes the merge gate a REAL barrier: it runs `merge:gate` as its
 * OWN statement (no pipe), reads the gate's exit code EXPLICITLY via
 * `shouldMerge`, and spawns `gh pr merge` ONLY on exit 0. The regression it
 * fixes: `pnpm merge:gate <N> | tail && gh pr merge …` made the shell observe
 * `tail`'s exit (0), so a RED gate (exit 1) could not block the chained merge.
 *
 * The impure half (the real `node`/`gh` spawns) is exercised live; the decision
 * seam and the injected-runner orchestration are unit-tested here on the
 * established guard-test harness. No real subprocess is spawned — the gate,
 * merge, and exit are stubbed (`exit` throws to halt control flow the way
 * `process.exit` would).
 */

/** A throwing exit stub that records the last exit code, mimicking process.exit. */
function makeExit() {
  const state = { code: /** @type {number|undefined} */ (undefined) };
  const exit = (code: number): never => {
    state.code = code;
    throw new Error(`exit:${code}`);
  };
  return { state, exit };
}

describe("merge-when-green shouldMerge() (#928)", () => {
  it("is true only for gate exit 0 (GREEN)", () => {
    expect(shouldMerge(0)).toBe(true);
  });

  it("is false for a RED gate (exit 1) — the barrier the pipe lost", () => {
    expect(shouldMerge(1)).toBe(false);
  });

  it("is false for TIMEOUT (2), worktree refusal (4), and a null spawn status", () => {
    expect(shouldMerge(2)).toBe(false);
    expect(shouldMerge(4)).toBe(false);
    expect(shouldMerge(null)).toBe(false);
    expect(shouldMerge(undefined)).toBe(false);
  });
});

describe("merge-when-green mergeWhenGreen() barrier (#928)", () => {
  it("RED gate (exit 1): merge runner NEVER invoked, gate exit propagated", () => {
    let mergeCalls = 0;
    const { state, exit } = makeExit();
    expect(() =>
      mergeWhenGreen(123, [], {
        gate: () => ({ status: 1 }) as never, // stubbed RED gate
        merge: () => {
          mergeCalls += 1;
          return { status: 0 } as never;
        },
        exit,
        log: () => {},
        err: () => {},
      }),
    ).toThrow("exit:1");
    expect(mergeCalls).toBe(0);
    expect(state.code).toBe(1);
  });

  it("TIMEOUT gate (exit 2): no merge, exit 2 propagated", () => {
    let mergeCalls = 0;
    const { state, exit } = makeExit();
    expect(() =>
      mergeWhenGreen(123, [], {
        gate: () => ({ status: 2 }) as never,
        merge: () => {
          mergeCalls += 1;
          return { status: 0 } as never;
        },
        exit,
        log: () => {},
        err: () => {},
      }),
    ).toThrow("exit:2");
    expect(mergeCalls).toBe(0);
    expect(state.code).toBe(2);
  });

  it("GREEN gate (exit 0): merge runner IS invoked with the PR number, exit 0", () => {
    let mergedPr = -1;
    const { state, exit } = makeExit();
    expect(() =>
      mergeWhenGreen(456, [], {
        gate: () => ({ status: 0 }) as never, // stubbed GREEN gate
        merge: (pr: number) => {
          mergedPr = pr;
          return { status: 0 } as never;
        },
        exit,
        log: () => {},
        err: () => {},
      }),
    ).toThrow("exit:0");
    expect(mergedPr).toBe(456);
    expect(state.code).toBe(0);
  });

  it("forwards the gate's extra args; a failed gh merge propagates gh's exit code", () => {
    let gateArgs: string[] = [];
    const { state, exit } = makeExit();
    expect(() =>
      mergeWhenGreen(789, ["--timeout", "60"], {
        gate: (_pr: number, extra: string[]) => {
          gateArgs = extra;
          return { status: 0 } as never;
        },
        merge: () => ({ status: 1 }) as never, // gh pr merge failed
        exit,
        log: () => {},
        err: () => {},
      }),
    ).toThrow("exit:1");
    expect(gateArgs).toEqual(["--timeout", "60"]);
    expect(state.code).toBe(1);
  });
});
