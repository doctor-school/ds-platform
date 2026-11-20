import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  failCode,
  issueCandidates,
  landPr,
  mainSyncPullOutcome,
  mainSyncRefusal,
  STAGES,
  stageRemedy,
} from "../../gh/pr-land.mjs";

/**
 * pr:land — unit cover for `tools/gh/pr-land.mjs`'s pure seams and its
 * five-stage closeout-tail orchestration (#1026).
 *
 * The wrapper chains gate → merge → board-Done → teardown → re-sweep as its
 * OWN injected-runner invocations (no pipe, no `&&` — the #928 class), aborts
 * on the FIRST non-zero stage with the stage named and a non-zero exit, and
 * skips teardown when no `.claude/worktrees/<N>` exists. No real subprocess is
 * spawned here — every runner is stubbed, and `exit` throws to halt control
 * flow the way `process.exit` would (mirrors merge-when-green.spec.ts).
 *
 * Platform-agnostic by construction: no drive-letter literals — the source
 * file for the no-pipe scan is resolved relative to `import.meta.url`.
 */

/** A throwing exit stub that records the last exit code, mimicking process.exit. */
function makeExit() {
  const state = { code: /** @type {number|undefined} */ undefined };
  const exit = (code: number): never => {
    state.code = code;
    throw new Error(`exit:${code}`);
  };
  return { state, exit };
}

/** All-green runner set that records invocation order; override per test. */
function makeIo(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const { state, exit } = makeExit();
  const io = {
    resolveContext: () => {
      calls.push("resolve");
      return { ok: true, issues: [1026], branch: "tooling/1026-slug" };
    },
    gate: () => {
      calls.push("gate");
      return { status: 0 };
    },
    merge: () => {
      calls.push("merge");
      return { status: 0 };
    },
    mergedSha: () => "abcdef1234567890",
    mainSync: () => {
      calls.push("main-sync");
      return { ok: true, sha: "abcdef123456" };
    },
    clearBoardItem: () => {
      calls.push("board-clear");
      return { status: "deleted", detail: "PVTI_pr" };
    },
    boardDone: (issue: number) => {
      calls.push(`board-done:${issue}`);
      return { status: 0 };
    },
    worktreeExists: () => true,
    teardown: (n: number) => {
      calls.push(`teardown:${n}`);
      return { status: 0 };
    },
    listOpenPrs: () => {
      calls.push("re-sweep:prs");
      return { status: 0, count: 2 };
    },
    listRemoteBranches: () => {
      calls.push("re-sweep:branches");
      return { status: 0, count: 3 };
    },
    exit,
    log: () => {},
    err: () => {},
    ...overrides,
  };
  return { io, calls, state };
}

describe("pr-land pure seams (#1026)", () => {
  it("STAGES is the canonical closeout order (main-sync right after merge, #4181; board-clear before board-done, #1140)", () => {
    expect(STAGES).toEqual([
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done",
      "teardown",
      "re-sweep",
    ]);
  });

  it("issueCandidates: linked issues + branch number, deduped, order-preserving", () => {
    expect(issueCandidates([1026, 999], "tooling/1026-pr-land")).toEqual([
      1026, 999,
    ]);
    expect(issueCandidates([], "feat/42-thing")).toEqual([42]);
    expect(issueCandidates([7], "no-number-branch")).toEqual([7]);
    expect(issueCandidates(null, null)).toEqual([]);
    expect(issueCandidates([0, -1, 2.5], "chore/dsp-193-repo-hygiene")).toEqual(
      [],
    );
  });

  it("stageRemedy: every stage has a non-empty one-line remedy", () => {
    for (const stage of STAGES) {
      const remedy = stageRemedy(stage, 123);
      expect(remedy.length).toBeGreaterThan(0);
      expect(remedy).not.toMatch(/\n/);
    }
  });

  it("failCode: propagates non-zero, never returns 0 (signal-killed child, #978)", () => {
    expect(failCode(2)).toBe(2);
    expect(failCode(4)).toBe(4);
    expect(failCode(0)).toBe(1);
    expect(failCode(null)).toBe(1);
    expect(failCode(undefined)).toBe(1);
  });
});

describe("pr-land landPr() stage ordering (#1026)", () => {
  it("uses the canonical hard pre-merge preflight and has no raw merge-gate spawn (#1637)", () => {
    const source = readFileSync(
      new URL("../../gh/pr-land.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"tools/lint/pr-preflight.mjs"');
    expect(source).toContain('"--pre-merge"');
    expect(source).not.toContain('["tools/gh/merge-gate.mjs"');
  });

  it("all-green: stages run in canonical order and exit 0", () => {
    const { io, calls, state } = makeIo();
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
      "teardown:1026",
      "re-sweep:prs",
      "re-sweep:branches",
    ]);
    expect(state.code).toBe(0);
  });

  it("forwards the gate's extra args verbatim (--mode-a-exempt included)", () => {
    let gateArgs: string[] = [];
    const { io } = makeIo({
      gate: (_pr: number, extra: string[]) => {
        gateArgs = extra;
        return { status: 0 };
      },
    });
    expect(() =>
      landPr(55, ["--mode-a-exempt", "pure docs"], io as never),
    ).toThrow("exit:0");
    expect(gateArgs).toEqual(["--mode-a-exempt", "pure docs"]);
  });
});

describe("pr-land landPr() abort-on-FAIL (#1026)", () => {
  it("RED gate (exit 1): later stages NEVER run, stage named, exit 1", () => {
    const errors: string[] = [];
    const { io, calls, state } = makeIo({
      gate: () => {
        calls.push("gate");
        return { status: 1 };
      },
      err: (msg: string) => errors.push(msg),
    });
    // makeIo's default gate is overridden — re-derive calls from the stub above.
    expect(() => landPr(55, [], io as never)).toThrow("exit:1");
    expect(calls).toEqual(["resolve", "gate"]);
    expect(state.code).toBe(1);
    expect(errors.join("\n")).toMatch(/stage 'gate' FAILED/);
  });

  it("TIMEOUT gate (exit 2) and worktree refusal (exit 4) propagate unchanged", () => {
    for (const code of [2, 4]) {
      const { io, calls, state } = makeIo({
        gate: () => {
          calls.push("gate");
          return { status: code };
        },
      });
      expect(() => landPr(55, [], io as never)).toThrow(`exit:${code}`);
      expect(calls).toEqual(["resolve", "gate"]);
      expect(state.code).toBe(code);
    }
  });

  it("failed merge: board/teardown/sweep never run, stage named, non-zero exit", () => {
    const errors: string[] = [];
    const { io, calls, state } = makeIo({
      merge: () => {
        calls.push("merge");
        return { status: 1 };
      },
      err: (msg: string) => errors.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:1");
    expect(calls).toEqual(["resolve", "gate", "merge"]);
    expect(state.code).toBe(1);
    expect(errors.join("\n")).toMatch(/stage 'merge' FAILED/);
  });

  it("signal-killed merge (status:null) NEVER exits 0 (#978)", () => {
    const { io, state } = makeIo({
      merge: () => ({ status: null, signal: "SIGTERM" }),
    });
    expect(() => landPr(55, [], io as never)).toThrow(/^exit:/);
    expect(state.code).not.toBe(0);
  });

  it("failed board-done aborts BEFORE teardown/re-sweep, non-zero exit", () => {
    const errors: string[] = [];
    const { io, calls, state } = makeIo({
      boardDone: (issue: number) => {
        calls.push(`board-done:${issue}`);
        return { status: 1 };
      },
      err: (msg: string) => errors.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:1");
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
    ]);
    expect(state.code).toBe(1);
    expect(errors.join("\n")).toMatch(/stage 'board-done' FAILED/);
  });

  it("failed teardown aborts BEFORE re-sweep, non-zero exit", () => {
    const { io, calls, state } = makeIo({
      teardown: (n: number) => {
        calls.push(`teardown:${n}`);
        return { status: 1 };
      },
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:1");
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
      "teardown:1026",
    ]);
    expect(state.code).toBe(1);
  });

  it("context-resolution failure exits 3 BEFORE the gate (nothing gated/merged)", () => {
    const { io, calls, state } = makeIo({
      resolveContext: () => {
        calls.push("resolve");
        return { ok: false, message: "gh pr view failed" };
      },
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:3");
    expect(calls).toEqual(["resolve"]);
    expect(state.code).toBe(3);
  });
});

describe("pr-land landPr() skip semantics (#1026)", () => {
  it("teardown SKIPPED (runner never invoked) when no worktree exists — still exit 0", () => {
    const logs: string[] = [];
    const { io, calls, state } = makeIo({
      worktreeExists: () => false,
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
      "re-sweep:prs",
      "re-sweep:branches",
    ]);
    expect(state.code).toBe(0);
    expect(logs.join("")).toMatch(/teardown: SKIP/);
  });

  it("no linked Closes-issue: board-done SKIPPED loudly, tail continues to exit 0", () => {
    const logs: string[] = [];
    const { io, calls, state } = makeIo({
      resolveContext: () => {
        calls.push("resolve");
        return { ok: true, issues: [], branch: "tooling/77-slug" };
      },
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    // board-done runner never invoked; teardown still keyed off the branch number.
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "teardown:77",
      "re-sweep:prs",
      "re-sweep:branches",
    ]);
    expect(state.code).toBe(0);
    expect(logs.join("")).toMatch(/board-done: SKIP/);
  });
});

describe("pr-land board-clear stage — NON-FATAL (#1140)", () => {
  it("deleted: reports OK and the tail runs to exit 0", () => {
    const logs: string[] = [];
    const { io, state } = makeIo({
      clearBoardItem: () => ({ status: "deleted", detail: "PVTI_pr" }),
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(state.code).toBe(0);
    expect(logs.join("")).toMatch(/board-clear: OK/);
  });

  it("absent (PR not on board): reports SKIP, tail still exits 0", () => {
    const logs: string[] = [];
    const { io, state } = makeIo({
      clearBoardItem: () => ({ status: "absent" }),
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(state.code).toBe(0);
    expect(logs.join("")).toMatch(/board-clear: SKIP/);
  });

  it("error: NON-FATAL — reports WARN, does NOT abort, tail still exits 0", () => {
    const logs: string[] = [];
    const { io, calls, state } = makeIo({
      clearBoardItem: () => {
        calls.push("board-clear");
        return { status: "error", detail: "gh api graphql exited 1" };
      },
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(state.code).toBe(0);
    // the later stages STILL run — a board-clear failure never aborts the tail
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
      "teardown:1026",
      "re-sweep:prs",
      "re-sweep:branches",
    ]);
    expect(logs.join("")).toMatch(/board-clear: WARN \(non-fatal/);
  });
});

describe("pr-land main-sync stage (#4181)", () => {
  it("OK: prints `main-sync: OK <sha>` and the tail exits 0", () => {
    const logs: string[] = [];
    const { io, state } = makeIo({ log: (msg: string) => logs.push(msg) });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(state.code).toBe(0);
    expect(logs.join("")).toMatch(/main-sync: OK abcdef123456/);
  });

  it("runs against the resolved main tree, never the cwd guess", () => {
    let tree = "";
    const { io } = makeIo({
      mainTree: "/repos/ds-platform",
      mainSync: (t: string) => {
        tree = t;
        return { ok: true, sha: "abc" };
      },
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:0");
    expect(tree).toBe("/repos/ds-platform");
  });

  it("FAIL: the remaining tail still runs, then a non-zero exit names the reason", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const { io, calls, state } = makeIo({
      mainSync: () => {
        calls.push("main-sync");
        return {
          ok: false,
          reason: "index lock present (/repos/ds-platform/.git/index.lock)",
        };
      },
      log: (msg: string) => logs.push(msg),
      err: (msg: string) => errors.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:1");
    expect(calls).toEqual([
      "resolve",
      "gate",
      "merge",
      "main-sync",
      "board-clear",
      "board-done:1026",
      "teardown:1026",
      "re-sweep:prs",
      "re-sweep:branches",
    ]);
    expect(state.code).toBe(1);
    expect(logs.join("")).toMatch(
      /main-sync: FAIL \(index lock present \(\/repos\/ds-platform\/\.git\/index\.lock\)\)/,
    );
    expect(logs.join("")).not.toMatch(/closeout tail COMPLETE/);
    expect(errors.join("\n")).toMatch(/stage 'main-sync' FAILED/);
  });

  it("FAIL followed by a failing later stage still exits non-zero with both lines reported", () => {
    const logs: string[] = [];
    const { io, state } = makeIo({
      mainSync: () => ({
        ok: false,
        reason: "main tree not on main (on feat/1-x)",
      }),
      teardown: () => ({ status: 2 }),
      log: (msg: string) => logs.push(msg),
    });
    expect(() => landPr(55, [], io as never)).toThrow("exit:2");
    expect(state.code).toBe(2);
    expect(logs.join("")).toMatch(/main-sync: FAIL/);
    expect(logs.join("")).toMatch(/teardown: FAIL/);
  });

  it("mainSyncRefusal: a held index lock refuses before any pull", () => {
    expect(
      mainSyncRefusal({
        lockPath: "/r/.git/index.lock",
        branch: "main",
        dirty: [],
      }),
    ).toBe("index lock present (/r/.git/index.lock)");
  });

  it("mainSyncRefusal: not on main / detached HEAD", () => {
    expect(
      mainSyncRefusal({ lockPath: null, branch: "feat/9-x", dirty: [] }),
    ).toBe("main tree not on main (on feat/9-x)");
    expect(mainSyncRefusal({ lockPath: null, branch: null, dirty: [] })).toBe(
      "main tree not on main (detached HEAD)",
    );
  });

  it("mainSyncRefusal: dirty tracked files are named", () => {
    expect(
      mainSyncRefusal({
        lockPath: null,
        branch: "main",
        dirty: [" M AGENTS.md", "M  tools/x.ts"],
      }),
    ).toBe("tracked changes in the main tree: M AGENTS.md, M tools/x.ts");
  });

  it("mainSyncRefusal: a clean idle main tree is not refused", () => {
    expect(
      mainSyncRefusal({ lockPath: null, branch: "main", dirty: [] }),
    ).toBeNull();
  });

  it("mainSyncPullOutcome: non-fast-forward, lock race and other git errors", () => {
    expect(
      mainSyncPullOutcome({
        pull: {
          status: 128,
          stderr:
            "hint: Diverging branches can't be fast-forwarded, you need to either:\nfatal: Not possible to fast-forward, aborting.\n",
        },
      }),
    ).toEqual({
      ok: false,
      reason: "non-fast-forward (local main diverged from origin/main)",
    });
    expect(
      mainSyncPullOutcome({
        pull: {
          status: 128,
          stderr:
            "fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git process seems to be running",
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "index lock present (fatal: Unable to create '/r/.git/index.lock': File exists.)",
    });
    expect(
      mainSyncPullOutcome({
        pull: {
          status: 1,
          stderr:
            "\nfatal: unable to access 'https://github.com/x/': Could not resolve host\nmore",
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "git pull failed: fatal: unable to access 'https://github.com/x/': Could not resolve host",
    });
    expect(mainSyncPullOutcome({ pull: { status: null, stderr: "" } })).toEqual(
      { ok: false, reason: "git pull failed: exit null" },
    );
  });

  it("mainSyncPullOutcome: a pull that leaves main behind origin/main is a FAIL (main-sync.ts behind-check)", () => {
    expect(
      mainSyncPullOutcome({
        pull: { status: 0, stderr: "" },
        head: "abc123",
        behindCount: 2,
      }),
    ).toEqual({
      ok: false,
      reason:
        "still behind after the pull: local `main` is 2 commit(s) BEHIND `origin/main`",
    });
    const unknown = mainSyncPullOutcome({
      pull: { status: 0, stderr: "" },
      head: "abc123",
      behindCount: null,
      behindError: "fatal: bad revision",
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toMatch(/fatal: bad revision/);
  });

  it("mainSyncPullOutcome: in sync after the pull → OK with the head SHA", () => {
    expect(
      mainSyncPullOutcome({
        pull: { status: 0, stderr: "" },
        head: "abc123def456",
        behindCount: 0,
      }),
    ).toEqual({ ok: true, sha: "abc123def456" });
  });

  it("a lock is reported, never deleted: the source removes no file", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../gh/pr-land.mjs", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\b(unlinkSync|rmSync|unlink|rm)\(/);
  });
});

describe("pr-land no-pipe discipline (#1026)", () => {
  it("source spawns every stage as its own statement — no shell, no pipe, no exec", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../gh/pr-land.mjs", import.meta.url)),
      "utf8",
    );
    // Each stage is a spawnSync argv array; nothing routes through a shell
    // where a pipe could mask an exit code (#928 root cause).
    expect(source).not.toMatch(/shell:\s*true/);
    expect(source).not.toMatch(/\bexecSync\b/);
    // (?<!\.) — `RegExp.prototype.exec(...)` is fine; child_process exec(...) is not.
    expect(source).not.toMatch(/(?<!\.)\bexec\(/);
    expect(source).not.toMatch(/\|\s*tail/);
    expect(source).toMatch(/spawnSync/);
  });
});
