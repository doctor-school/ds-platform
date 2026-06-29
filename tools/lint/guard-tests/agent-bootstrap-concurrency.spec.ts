import { describe, expect, it } from "vitest";

import {
  encodeProjectSlug,
  isRepoSessionDir,
  isSharedMainTree,
  liveParallelSessions,
} from "../../agent-bootstrap";

/**
 * Unit cover for `agent-bootstrap.ts`'s parallel-session + shared-tree detector
 * (#359). These are the script's pure seams — guarded behind the entry-point
 * check, so importing them here does NOT fire `main()` / its subprocesses.
 *
 * Driver (#359): the user runs PARALLEL sessions in one repo; a session editing
 * the shared main tree while another is live sweeps uncommitted edits into the
 * wrong PR (happened on #345/#355). The detector surfaces that risk at session
 * start so `pnpm task:worktree <N>` is the one obvious next step.
 */
const NOW = 1_000_000_000_000; // fixed epoch ms
const WINDOW = 10 * 60 * 1000; // 10 minutes
const log = (id: string, ageMs: number, inSharedMainTree = true) => ({
  id,
  mtimeMs: NOW - ageMs,
  inSharedMainTree,
});

describe("agent-bootstrap liveParallelSessions()", () => {
  it("counts only logs touched within the window, excluding self", () => {
    const logs = [
      log("self", 5_000),
      log("a", 60_000), // 1 min — live
      log("b", 9 * 60_000), // 9 min — live
      log("c", 20 * 60_000), // 20 min — stale, excluded
    ];
    const r = liveParallelSessions(logs, {
      nowMs: NOW,
      windowMs: WINDOW,
      selfId: "self",
    });
    expect(r.total).toBe(2);
  });

  it("treats a future mtime (clock skew) as live, never negative", () => {
    const logs = [log("self", 0), log("future", -7_000)]; // 7s ahead of now
    const r = liveParallelSessions(logs, {
      nowMs: NOW,
      windowMs: WINDOW,
      selfId: "self",
    });
    expect(r.total).toBe(1);
  });

  it("never counts the current session even when freshly written", () => {
    const logs = [log("self", 100)];
    const r = liveParallelSessions(logs, {
      nowMs: NOW,
      windowMs: WINDOW,
      selfId: "self",
    });
    expect(r.total).toBe(0);
  });

  it("breaks the live count down by shared-main-tree membership", () => {
    const logs = [
      log("self", 1_000),
      log("main-peer", 60_000, true),
      log("wt-peer", 60_000, false),
    ];
    const r = liveParallelSessions(logs, {
      nowMs: NOW,
      windowMs: WINDOW,
      selfId: "self",
    });
    expect(r.total).toBe(2);
    expect(r.inMainTree).toBe(1);
  });

  it("an unknown selfId excludes nothing (over-count is safer than hiding)", () => {
    const logs = [log("a", 1_000), log("b", 1_000)];
    const r = liveParallelSessions(logs, {
      nowMs: NOW,
      windowMs: WINDOW,
      selfId: "",
    });
    expect(r.total).toBe(2);
  });
});

describe("agent-bootstrap isSharedMainTree()", () => {
  const cwd = "C:/Users/sidor/repos/ds-platform";

  it("is true in the primary tree (git-dir === common-dir)", () => {
    expect(isSharedMainTree(".git", ".git", cwd)).toBe(true);
  });

  it("is false inside a linked worktree (git-dir under .git/worktrees)", () => {
    expect(
      isSharedMainTree(
        "C:/Users/sidor/repos/ds-platform/.git/worktrees/359",
        "C:/Users/sidor/repos/ds-platform/.git",
        cwd,
      ),
    ).toBe(false);
  });

  it("normalizes separators and case before comparing (Windows)", () => {
    expect(
      isSharedMainTree(
        "C:\\Users\\sidor\\repos\\ds-platform\\.git",
        "C:/Users/sidor/repos/ds-platform/.git/",
        cwd,
      ),
    ).toBe(true);
  });
});

describe("agent-bootstrap isRepoSessionDir()", () => {
  const main = "C--Users-sidor-repos-ds-platform";

  it("matches the primary tree's slug exactly", () => {
    expect(isRepoSessionDir(main, main)).toBe(true);
  });

  it("matches a linked-worktree sibling via the worktree separator", () => {
    expect(isRepoSessionDir(`${main}--claude-worktrees-359`, main)).toBe(true);
  });

  it("rejects a sibling repo whose slug merely starts the same way", () => {
    expect(isRepoSessionDir(`${main}-2`, main)).toBe(false);
    expect(isRepoSessionDir(`${main}-staging`, main)).toBe(false);
  });
});

describe("agent-bootstrap encodeProjectSlug()", () => {
  it("encodes a repo path the way Claude Code names its project log dir", () => {
    expect(encodeProjectSlug("C:\\Users\\sidor\\repos\\ds-platform")).toBe(
      "C--Users-sidor-repos-ds-platform",
    );
  });

  it("encodes a worktree path with the same dashing rule", () => {
    expect(
      encodeProjectSlug(
        "C:\\Users\\sidor\\repos\\ds-platform\\.claude\\worktrees\\359",
      ),
    ).toBe("C--Users-sidor-repos-ds-platform--claude-worktrees-359");
  });
});
