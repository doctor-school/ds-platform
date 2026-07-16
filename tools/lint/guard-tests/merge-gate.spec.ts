import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertOpenPr,
  branchWorktreeMessage,
  classifyCheckRuns,
  classifyModeAVerdict,
  cwdGuardMessage,
  findBranchWorktree,
  isWorktreeCwd,
  latestRunsByName,
  parseModeAExempt,
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

  it("EARS-955.4: an in-flight re-run outranks its completed predecessor → pending, not a premature green", () => {
    // A PR-body edit re-triggers a body guard on the SAME head SHA; the fresh
    // in_progress run must win the name group so the board still reads pending
    // (head-pinning cannot catch an unchanged SHA) (#960 review).
    const runs = [
      {
        name: "spec-link",
        status: "completed",
        conclusion: "success",
        started_at: "2026-07-15T10:00:00Z",
        completed_at: "2026-07-15T10:00:15Z",
      },
      {
        name: "spec-link",
        status: "in_progress",
        conclusion: null,
        started_at: "2026-07-15T10:00:30Z",
        completed_at: null,
      },
    ];
    const verdict = classifyCheckRuns(runs);
    expect(verdict.state).toBe("pending");
    expect(verdict.pending).toEqual(["spec-link"]);
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

  it("ranks a non-completed run newest over its completed predecessor", () => {
    const runs = [
      {
        name: "x",
        status: "completed",
        conclusion: "success",
        completed_at: "2026-07-15T10:00:15Z",
      },
      { name: "x", status: "in_progress", conclusion: null },
    ];
    const latest = latestRunsByName(runs);
    expect(latest).toHaveLength(1);
    expect(latest[0].status).toBe("in_progress");
  });

  it("returns [] for non-array input", () => {
    expect(latestRunsByName(null)).toEqual([]);
    expect(latestRunsByName(undefined)).toEqual([]);
  });
});

describe("merge-gate assertOpenPr() (#963)", () => {
  it("accepts an OPEN PR with a head SHA", () => {
    const verdict = assertOpenPr(
      { state: "OPEN", headRefOid: "abc123" },
      "456",
    );
    expect(verdict.ok).toBe(true);
  });

  it("accepts an OPEN draft PR (a draft is still OPEN)", () => {
    // A draft PR resolves state OPEN; the gate does not read the draft flag.
    expect(assertOpenPr({ state: "OPEN", headRefOid: "abc123" }, "456").ok).toBe(
      true,
    );
  });

  it("rejects a CLOSED PR (its check-runs are stale — silent no-op)", () => {
    const verdict = assertOpenPr(
      { state: "CLOSED", headRefOid: "deadbeef" },
      "456",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("456");
    expect(verdict.message.toLowerCase()).toContain("open");
  });

  it("rejects a MERGED PR", () => {
    const verdict = assertOpenPr(
      { state: "MERGED", headRefOid: "deadbeef" },
      "456",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("456");
  });

  it("rejects a missing state (issue number / unresolved) and names the arg + issue-vs-PR guidance", () => {
    const verdict = assertOpenPr({}, "963");
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("963");
    expect(verdict.message.toLowerCase()).toContain("issue number");
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

describe("merge-gate classifyModeAVerdict() (#992)", () => {
  const HEAD = "aaaa000000000000000000000000000000000000";
  const OLD = "bbbb000000000000000000000000000000000000";
  const modeABody = (verdict: string) =>
    `## Mode (a) Review — PR #992\n\n**Author:** claude\n\n### Findings\n\n- [NIT] example\n\n### Verdict\n\nVERDICT: ${verdict}\n`;

  it("is no-verdict when no review matches the Mode-a artifact shape", () => {
    expect(classifyModeAVerdict([], HEAD).state).toBe("no-verdict");
    expect(classifyModeAVerdict(undefined, HEAD).state).toBe("no-verdict");
    expect(classifyModeAVerdict(null, HEAD).state).toBe("no-verdict");
  });

  it("ignores non-Mode-a reviews (plain comments, approvals without the header/verdict line)", () => {
    const reviews = [
      { body: "LGTM!", state: "APPROVED", commit_id: HEAD },
      {
        body: "VERDICT: APPROVE", // verdict line without the Mode-a header
        commit_id: HEAD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
      {
        body: "## Mode (a) Review — PR #992\nno structured verdict line here",
        commit_id: HEAD,
        submitted_at: "2026-07-16T10:01:00Z",
      },
    ];
    expect(classifyModeAVerdict(reviews, HEAD).state).toBe("no-verdict");
  });

  it("is request-changes when the latest Mode-a verdict is REQUEST_CHANGES (even after an older APPROVE)", () => {
    const reviews = [
      {
        body: modeABody("APPROVE"),
        commit_id: HEAD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
      {
        body: modeABody("REQUEST_CHANGES"),
        commit_id: HEAD,
        submitted_at: "2026-07-16T11:00:00Z",
      },
    ];
    expect(classifyModeAVerdict(reviews, HEAD).state).toBe("request-changes");
  });

  it("is stale-approve when the latest APPROVE's commit_id is not the current head (rework invalidates)", () => {
    const reviews = [
      {
        body: modeABody("APPROVE"),
        commit_id: OLD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
    ];
    const verdict = classifyModeAVerdict(reviews, HEAD);
    expect(verdict.state).toBe("stale-approve");
    expect(verdict.commitId).toBe(OLD);
  });

  it("is fresh-approve only for an APPROVE whose commit_id equals the head SHA", () => {
    const reviews = [
      {
        body: modeABody("APPROVE"),
        commit_id: HEAD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
    ];
    expect(classifyModeAVerdict(reviews, HEAD).state).toBe("fresh-approve");
  });

  it("a fresh re-review APPROVE supersedes an earlier REQUEST_CHANGES (latest by submitted_at wins)", () => {
    const reviews = [
      {
        body: modeABody("REQUEST_CHANGES"),
        commit_id: OLD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
      {
        body: modeABody("APPROVE"),
        commit_id: HEAD,
        submitted_at: "2026-07-16T11:00:00Z",
      },
    ];
    expect(classifyModeAVerdict(reviews, HEAD).state).toBe("fresh-approve");
  });

  it("a Mode-a review missing submitted_at sorts oldest; later array position breaks ties", () => {
    const reviews = [
      { body: modeABody("REQUEST_CHANGES"), commit_id: HEAD },
      {
        body: modeABody("APPROVE"),
        commit_id: HEAD,
        submitted_at: "2026-07-16T10:00:00Z",
      },
    ];
    expect(classifyModeAVerdict(reviews, HEAD).state).toBe("fresh-approve");
    // Equal (both missing) timestamps: the later review in the array wins.
    const untimed = [
      { body: modeABody("REQUEST_CHANGES"), commit_id: HEAD },
      { body: modeABody("APPROVE"), commit_id: HEAD },
    ];
    expect(classifyModeAVerdict(untimed, HEAD).state).toBe("fresh-approve");
  });
});

describe("merge-gate parseModeAExempt() (#992)", () => {
  it("is not exempt when the flag is absent", () => {
    expect(parseModeAExempt(["992"])).toEqual({ exempt: false, reason: null });
  });

  it("is exempt with the trimmed reason when the flag carries a non-empty reason", () => {
    const parsed = parseModeAExempt([
      "992",
      "--mode-a-exempt",
      " pure docs — AGENTS.md §3.8 fast path ",
    ]);
    expect(parsed.exempt).toBe(true);
    expect(parsed.reason).toBe("pure docs — AGENTS.md §3.8 fast path");
  });

  it("errors (not silently exempt) on a missing, empty, or flag-shaped reason", () => {
    for (const args of [
      ["992", "--mode-a-exempt"],
      ["992", "--mode-a-exempt", "   "],
      ["992", "--mode-a-exempt", "--timeout"],
    ]) {
      const parsed = parseModeAExempt(args);
      expect(parsed.exempt).toBe(false);
      expect(parsed.error).toContain("--mode-a-exempt");
    }
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
