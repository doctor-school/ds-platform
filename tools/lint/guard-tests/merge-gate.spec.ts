import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  branchWorktreeMessage,
  classifyCheckRuns,
  cwdGuardMessage,
  findBranchWorktree,
  isWorktreeCwd,
  latestRunsByName,
  worktreeNumber,
} from "../../gh/merge-gate.mjs";

/**
 * merge-gate — unit cover for `tools/gh/merge-gate.mjs`'s pure seams (#836).
 *
 * The gate is the deterministic Phase-0 pre-merge command (`pnpm merge:gate <N>`,
 * invoked by `pnpm pr:preflight <N> --pre-merge`): it resolves the PR head SHA,
 * requires >0 registered check-runs for THAT SHA with every non-skipped run
 * terminal-successful, and refuses to run from a worktree cwd. The impure half
 * (gh spawns, polling) is exercised live; the classification and worktree seams
 * are unit-tested here on the established guard-test harness.
 */
describe("merge-gate classifyCheckRuns() (#836)", () => {
  it("FAILS closed on zero registered check-runs (fresh-push race)", () => {
    // Retro 29f490ed F1: a watch started ~90s after push saw ZERO runs for the
    // new head SHA and read as green. Zero runs must never classify green.
    expect(classifyCheckRuns([]).state).toBe("empty");
    expect(classifyCheckRuns(undefined).state).toBe("empty");
    expect(classifyCheckRuns(null).state).toBe("empty");
    expect(classifyCheckRuns([]).state).not.toBe("green");
  });

  it("is green only when all non-skipped runs are terminal-successful", () => {
    const runs = [
      { name: "ci / test", status: "completed", conclusion: "success" },
      { name: "ci / lint", status: "completed", conclusion: "skipped" },
    ];
    expect(classifyCheckRuns(runs).state).toBe("green");
  });

  it("classifies a completed-success run named 'submit-pending' green (structured fields, not name grep)", () => {
    // Retro 29f490ed F1: `grep 'fail|pending'` over check NAMES false-flags a job
    // named `submit-pending`. The gate reads status/conclusion fields only —
    // the name must never influence the verdict.
    const runs = [
      { name: "submit-pending", status: "completed", conclusion: "success" },
      { name: "form-error", status: "completed", conclusion: "success" },
    ];
    expect(classifyCheckRuns(runs).state).toBe("green");
  });

  it("classifies an in_progress run pending even when its name says otherwise", () => {
    const runs = [
      { name: "all-pass-success", status: "in_progress", conclusion: null },
    ];
    const verdict = classifyCheckRuns(runs);
    expect(verdict.state).toBe("pending");
    expect(verdict.pending).toContain("all-pass-success");
  });

  it("classifies queued runs pending", () => {
    const runs = [{ name: "ci / test", status: "queued", conclusion: null }];
    expect(classifyCheckRuns(runs).state).toBe("pending");
  });

  it("is red on any non-successful terminal conclusion (failure/cancelled/timed_out/neutral)", () => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "neutral",
      "stale",
    ]) {
      const runs = [
        { name: "ci / test", status: "completed", conclusion },
        { name: "ci / lint", status: "completed", conclusion: "success" },
      ];
      const verdict = classifyCheckRuns(runs);
      expect(verdict.state).toBe("red");
      expect(verdict.red).toContain("ci / test");
    }
  });

  it("reports red immediately even while other runs are still pending (fail-fast)", () => {
    const runs = [
      { name: "ci / test", status: "completed", conclusion: "failure" },
      { name: "ci / e2e", status: "in_progress", conclusion: null },
    ];
    expect(classifyCheckRuns(runs).state).toBe("red");
  });

  it("treats an all-skipped board with registered runs as green (non-skipped set vacuously successful)", () => {
    const runs = [
      { name: "drift", status: "completed", conclusion: "skipped" },
      { name: "glossary", status: "completed", conclusion: "skipped" },
    ];
    expect(classifyCheckRuns(runs).state).toBe("green");
  });

  it("EARS-955: is green when superseded cancelled runs have a newer same-name success (RED→GREEN)", () => {
    // GitHub keeps BOTH runs on the head SHA: a PR-body edit's concurrency group
    // cancels the in-flight body guard, a success run replaces it ~40s later.
    // The stale `cancelled` must not read as blocking (permanent false RED).
    const bodyGuards = ["spec-link", "prior-decisions", "registry-research", "spec-status-fresh"];
    const runs = bodyGuards.flatMap((name) => [
      {
        name,
        status: "completed",
        conclusion: "cancelled",
        started_at: "2026-07-15T10:00:00Z",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name,
        status: "completed",
        conclusion: "success",
        started_at: "2026-07-15T10:00:30Z",
        completed_at: "2026-07-15T10:00:50Z",
      },
    ]);
    const verdict = classifyCheckRuns(runs);
    expect(verdict.state).toBe("green");
    expect(verdict.red).toEqual([]);
  });

  it("EARS-955.1: a cancelled run that IS the newest for its name is still red", () => {
    const runs = [
      {
        name: "spec-link",
        status: "completed",
        conclusion: "success",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name: "spec-link",
        status: "completed",
        conclusion: "cancelled",
        completed_at: "2026-07-15T10:00:50Z",
      },
    ];
    const verdict = classifyCheckRuns(runs);
    expect(verdict.state).toBe("red");
    expect(verdict.red).toEqual(["spec-link"]);
  });

  it("EARS-955.2: a failure run that IS the newest for its name is still red", () => {
    const runs = [
      {
        name: "ci / test",
        status: "completed",
        conclusion: "success",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name: "ci / test",
        status: "completed",
        conclusion: "failure",
        completed_at: "2026-07-15T10:00:50Z",
      },
    ];
    expect(classifyCheckRuns(runs).state).toBe("red");
  });

  it("EARS-955.3: mixed board — one name superseded→success, another genuinely failing → red naming only the failure", () => {
    const runs = [
      {
        name: "spec-link",
        status: "completed",
        conclusion: "cancelled",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name: "spec-link",
        status: "completed",
        conclusion: "success",
        completed_at: "2026-07-15T10:00:50Z",
      },
      {
        name: "ci / e2e",
        status: "completed",
        conclusion: "failure",
        completed_at: "2026-07-15T10:01:00Z",
      },
    ];
    const verdict = classifyCheckRuns(runs);
    expect(verdict.state).toBe("red");
    expect(verdict.red).toEqual(["ci / e2e"]);
  });
});

describe("merge-gate latestRunsByName() (#955)", () => {
  it("keeps one run per distinct name", () => {
    const runs = [
      { name: "a", status: "completed", conclusion: "success" },
      { name: "b", status: "completed", conclusion: "success" },
    ];
    expect(latestRunsByName(runs)).toHaveLength(2);
  });

  it("keeps the newest run per name by completed_at (superseded dropped)", () => {
    const runs = [
      {
        name: "spec-link",
        conclusion: "cancelled",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name: "spec-link",
        conclusion: "success",
        completed_at: "2026-07-15T10:00:50Z",
      },
    ];
    const latest = latestRunsByName(runs);
    expect(latest).toHaveLength(1);
    expect(latest[0].conclusion).toBe("success");
  });

  it("tie-breaks equal completed_at by started_at", () => {
    const runs = [
      {
        name: "x",
        conclusion: "cancelled",
        started_at: "2026-07-15T10:00:00Z",
        completed_at: "2026-07-15T10:00:50Z",
      },
      {
        name: "x",
        conclusion: "success",
        started_at: "2026-07-15T10:00:30Z",
        completed_at: "2026-07-15T10:00:50Z",
      },
    ];
    expect(latestRunsByName(runs)[0].conclusion).toBe("success");
  });

  it("final tie-break: higher numeric id wins", () => {
    const runs = [
      { name: "x", conclusion: "cancelled", id: 1 },
      { name: "x", conclusion: "success", id: 2 },
    ];
    expect(latestRunsByName(runs)[0].conclusion).toBe("success");
  });

  it("a run missing timestamps sorts oldest (a timestamped run wins its name)", () => {
    const runs = [
      { name: "x", conclusion: "success", completed_at: "2026-07-15T10:00:50Z" },
      { name: "x", conclusion: "cancelled" },
    ];
    expect(latestRunsByName(runs)[0].conclusion).toBe("success");
  });

  it("returns [] for non-array input", () => {
    expect(latestRunsByName(null)).toEqual([]);
    expect(latestRunsByName(undefined)).toEqual([]);
  });
});

describe("merge-gate isWorktreeCwd() (#836)", () => {
  // Paths are built with path.join from relative segments (platform-agnostic —
  // CI runs Linux, dev box is Windows); the raw two-separator strings below are
  // pure-string fixtures never resolved against the filesystem, exempt from the
  // no-absolute-literal rule (they exercise separator handling only).
  it("detects a cwd inside .claude/worktrees/<N>", () => {
    expect(
      isWorktreeCwd(join("repo", ".claude", "worktrees", "836")),
    ).toBe(true);
    expect(
      isWorktreeCwd(join("repo", ".claude", "worktrees", "836", "apps", "api")),
    ).toBe(true);
  });

  it("handles both separator styles (pure-string fixtures, never resolved)", () => {
    expect(isWorktreeCwd("repo/.claude/worktrees/836")).toBe(true);
    expect(isWorktreeCwd("repo\\.claude\\worktrees\\836")).toBe(true);
  });

  it("is false for the main tree and unrelated paths", () => {
    expect(isWorktreeCwd(join("repo"))).toBe(false);
    expect(isWorktreeCwd(join("repo", "apps", "api"))).toBe(false);
    expect(isWorktreeCwd(join("repo", ".claude", "rules"))).toBe(false);
    // the worktrees CONTAINER dir is not itself a worktree checkout
    expect(isWorktreeCwd(join("repo", ".claude", "worktrees"))).toBe(false);
  });
});

describe("merge-gate worktreeNumber() (#836)", () => {
  it("extracts the worktree slug from a worktree path", () => {
    expect(worktreeNumber(join("repo", ".claude", "worktrees", "836"))).toBe(
      "836",
    );
    expect(
      worktreeNumber(join("repo", ".claude", "worktrees", "836", "tools")),
    ).toBe("836");
  });

  it("returns null outside a worktree", () => {
    expect(worktreeNumber(join("repo", "apps"))).toBeNull();
  });
});

describe("merge-gate cwdGuardMessage() (#836)", () => {
  it("names the teardown command and the main tree in the actionable message", () => {
    const msg = cwdGuardMessage(join("repo", ".claude", "worktrees", "836"));
    expect(msg).toContain("pnpm worktree:teardown 836");
    expect(msg.toLowerCase()).toContain("main tree");
    expect(msg).toContain("--delete-branch");
  });
});

describe("merge-gate findBranchWorktree() (#836)", () => {
  // `git worktree list --porcelain` output is a pure-string fixture — parsed,
  // never resolved against the filesystem (exempt from the path-literal rule).
  const porcelain = [
    "worktree /home/dev/ds-platform",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /home/dev/ds-platform/.claude/worktrees/836",
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/tooling/836-tooling-retro-deterministic-pre-merge-gate",
    "",
  ].join("\n");

  it("returns the worktree path holding the PR branch", () => {
    expect(
      findBranchWorktree(
        porcelain,
        "tooling/836-tooling-retro-deterministic-pre-merge-gate",
      ),
    ).toBe("/home/dev/ds-platform/.claude/worktrees/836");
  });

  it("returns null when no registered worktree holds the branch", () => {
    expect(findBranchWorktree(porcelain, "feat/999-not-here")).toBeNull();
    expect(findBranchWorktree("", "main")).toBeNull();
  });

  it("does not match on branch-name substrings", () => {
    // `main` is a substring of the 836 branch slug's path line — only the exact
    // `branch refs/heads/<branch>` record may match.
    expect(findBranchWorktree(porcelain, "836")).toBeNull();
  });
});

describe("merge-gate branchWorktreeMessage() (#836)", () => {
  it("instructs pnpm worktree:teardown <N> before --delete-branch for a numbered worktree", () => {
    const msg = branchWorktreeMessage(
      "tooling/836-slug",
      "/home/dev/ds-platform/.claude/worktrees/836",
    );
    expect(msg).toContain("pnpm worktree:teardown 836");
    expect(msg).toContain("--delete-branch");
  });

  it("falls back to the teardown script path for a non-standard worktree location", () => {
    const msg = branchWorktreeMessage("feat/x", "/somewhere/else");
    expect(msg).toContain("tools/dev/worktree-teardown.mjs");
    expect(msg).toContain("--delete-branch");
  });
});
