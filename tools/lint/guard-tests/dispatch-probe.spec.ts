import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STALE_THRESHOLD_SECONDS,
  classifyVerdict,
  formatAge,
  formatLine,
  gatherEvidence,
  parsePorcelainPath,
} from "../../gh/dispatch-probe.mjs";

/**
 * Unit cover for `tools/gh/dispatch-probe.mjs` (#744) — the background-dispatch
 * liveness checkpoint. Only the pure half (verdict classification, age
 * formatting, porcelain parsing, evidence gathering) is tested; the `git` side
 * and fs.stat go through injectable seams, so nothing here shells out (same
 * harness pattern as handoff-verify.spec.ts — imports the pure exports, never
 * fires `main()`).
 */

/** Fake git runner: canned {status,stdout} per stringified argv. */
function fakeRunner(table: Record<string, { status: number; stdout: string }>) {
  const calls: string[][] = [];
  return {
    calls,
    git(cwd: string, args: string[]) {
      calls.push(args);
      const hit = table[args.join(" ")];
      return hit
        ? { ...hit, stderr: "" }
        : { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    },
  };
}

const T = STALE_THRESHOLD_SECONDS; // 600

describe("dispatch-probe classifyVerdict()", () => {
  it("commits since dispatch → ALIVE regardless of age or dirty count", () => {
    expect(
      classifyVerdict({ commitCount: 1, dirtyCount: 0, ageSeconds: 9999 }),
    ).toEqual({
      verdict: "ALIVE",
      killAdvised: false,
    });
    expect(
      classifyVerdict({ commitCount: 3, dirtyCount: 5, ageSeconds: 0 }).verdict,
    ).toBe("ALIVE");
  });

  it("no commits + dirty files recently touched (age < threshold) → ALIVE", () => {
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 2, ageSeconds: T - 1 }),
    ).toEqual({
      verdict: "ALIVE",
      killAdvised: false,
    });
  });

  it("no commits + dirty files gone quiet (age ≥ threshold) → QUIET", () => {
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 2, ageSeconds: T }),
    ).toEqual({
      verdict: "QUIET",
      killAdvised: false,
    });
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 1, ageSeconds: T + 500 })
        .verdict,
    ).toBe("QUIET");
  });

  it("clean tree below threshold → STILL-CLEAN, no kill advice yet", () => {
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 0, ageSeconds: T - 1 }),
    ).toEqual({
      verdict: "STILL-CLEAN",
      killAdvised: false,
    });
  });

  it("clean tree at/over threshold → STILL-CLEAN + kill advised (≈10-min rule)", () => {
    expect(
      classifyVerdict({ commitCount: 0, dirtyCount: 0, ageSeconds: T }),
    ).toEqual({
      verdict: "STILL-CLEAN",
      killAdvised: true,
    });
  });

  it("honors an explicit threshold override", () => {
    const at120 = {
      commitCount: 0,
      dirtyCount: 1,
      ageSeconds: 130,
      thresholdSeconds: 120,
    };
    expect(classifyVerdict(at120).verdict).toBe("QUIET");
    expect(classifyVerdict({ ...at120, ageSeconds: 110 }).verdict).toBe(
      "ALIVE",
    );
  });
});

describe("dispatch-probe formatAge()", () => {
  it("renders seconds / minutes / hours compactly", () => {
    expect(formatAge(0)).toBe("0s");
    expect(formatAge(45)).toBe("45s");
    expect(formatAge(600)).toBe("10m");
    expect(formatAge(587)).toBe("9m47s");
    expect(formatAge(3600)).toBe("1h");
    expect(formatAge(3900)).toBe("1h5m");
  });

  it("clamps negatives to 0s and rounds", () => {
    expect(formatAge(-5)).toBe("0s");
    expect(formatAge(1.4)).toBe("1s");
  });
});

describe("dispatch-probe parsePorcelainPath()", () => {
  it("reads the path after the 2-col status + space", () => {
    expect(parsePorcelainPath(" M tools/gh/dispatch-probe.mjs")).toBe(
      "tools/gh/dispatch-probe.mjs",
    );
    expect(parsePorcelainPath("?? new-file.ts")).toBe("new-file.ts");
  });

  it("takes the destination of a rename", () => {
    expect(parsePorcelainPath("R  old/name.ts -> new/name.ts")).toBe(
      "new/name.ts",
    );
  });

  it("strips surrounding quotes from special-char paths", () => {
    expect(parsePorcelainPath('?? "with space.txt"')).toBe("with space.txt");
  });
});

describe("dispatch-probe gatherEvidence()", () => {
  const wt = "C:/repo/.claude/worktrees/744";

  it("counts branch commits and uses the last commit time for age (ALIVE path)", () => {
    const commitSecs = 1_700_000_000;
    const runner = fakeRunner({
      "rev-list --count origin/main..HEAD": { status: 0, stdout: "2\n" },
      "status --porcelain": { status: 0, stdout: "" },
      "log -1 --format=%ct HEAD": { status: 0, stdout: `${commitSecs}\n` },
    });
    const nowMs = (commitSecs + 90) * 1000;
    const ev = gatherEvidence({
      worktreePath: wt,
      runner,
      statMtime: () => null,
      nowMs,
    });
    expect(ev).toEqual({ commitCount: 2, dirtyCount: 0, ageSeconds: 90 });
  });

  it("no commits + dirty files → age from newest dirty mtime", () => {
    const runner = fakeRunner({
      "rev-list --count origin/main..HEAD": { status: 0, stdout: "0\n" },
      "status --porcelain": { status: 0, stdout: " M a.ts\n?? b.ts\n" },
    });
    const nowMs = 1_000_000;
    // a.ts touched 300s ago, b.ts 120s ago → newest = 120s ago.
    const mtimes: Record<string, number> = {
      [join(wt, "a.ts")]: nowMs - 300_000,
      [join(wt, "b.ts")]: nowMs - 120_000,
    };
    const ev = gatherEvidence({
      worktreePath: wt,
      runner,
      statMtime: (p: string) => mtimes[p] ?? null,
      nowMs,
    });
    expect(ev).toEqual({ commitCount: 0, dirtyCount: 2, ageSeconds: 120 });
  });

  it("clean tree → age from the worktree .git link-file mtime (dispatch proxy)", () => {
    const runner = fakeRunner({
      "rev-list --count origin/main..HEAD": { status: 0, stdout: "0\n" },
      "status --porcelain": { status: 0, stdout: "" },
    });
    const nowMs = 5_000_000;
    const ev = gatherEvidence({
      worktreePath: wt,
      runner,
      statMtime: (p: string) =>
        p === join(wt, ".git") ? nowMs - 660_000 : null,
      nowMs,
    });
    expect(ev).toEqual({ commitCount: 0, dirtyCount: 0, ageSeconds: 660 });
  });

  it("treats a failed rev-list as zero commits (offline / no origin/main)", () => {
    const runner = fakeRunner({
      "status --porcelain": { status: 0, stdout: "" },
    });
    const ev = gatherEvidence({
      worktreePath: wt,
      runner,
      statMtime: () => 1000,
      nowMs: 1000,
    });
    expect(ev.commitCount).toBe(0);
  });
});

describe("dispatch-probe formatLine() end-to-end", () => {
  it("ALIVE line: no advice suffix", () => {
    const ev = { commitCount: 1, dirtyCount: 3, ageSeconds: 130 };
    expect(formatLine("744", ev, classifyVerdict(ev))).toBe(
      "ALIVE #744 age=2m10s commits=1 dirty=3",
    );
  });

  it("QUIET line carries the age", () => {
    const ev = { commitCount: 0, dirtyCount: 2, ageSeconds: 840 };
    expect(formatLine("744", ev, classifyVerdict(ev))).toBe(
      "QUIET #744 age=14m commits=0 dirty=2",
    );
  });

  it("STILL-CLEAN past threshold appends the kill advice", () => {
    const ev = { commitCount: 0, dirtyCount: 0, ageSeconds: 660 };
    expect(formatLine("744", ev, classifyVerdict(ev))).toBe(
      "STILL-CLEAN #744 age=11m commits=0 dirty=0 advice=kill+re-dispatch",
    );
  });
});
