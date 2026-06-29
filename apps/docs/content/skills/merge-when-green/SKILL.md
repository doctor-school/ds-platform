---
title: "merge-when-green"
description: "Procedural skill (inline): merge the PR via the single mandatory command, after positive review and green CI."
name: merge-when-green
mode: inline
---

# merge-when-green

**Kind:** procedural · **Mode:** inline.

## Input

- PR number `<N>`.
- Latest review verdict: `APPROVE` (from `request-mode-a-review` Mode (a), or a Mode (b) Codex review, or a Mode (c) human approval).
- Latest CI status: green.

## Procedure

**Step 1 — confirm CI green BY HAND first (Phase-0 manual gate).** In Phase 0 the repo is GitHub Free + private, so there is **no server-side required-checks gate**: `--auto` does **not** hold the merge for CI — it merges the instant an approval exists, even while checks are still pending (this is what merged L1 #278 ahead of a pending CI). So the real gate is manual. Run the deterministic wait helper, which blocks until **every** check is `pass`/`skipping` and exits non-zero if any is `fail`/`cancel` or still `pending` at timeout:

```bash
pnpm ci:wait <N>   # node tools/gh/wait-ci-green.mjs <N> [--timeout <sec>] [--interval <sec>]
```

Exit `0` = all green → proceed to step 2. Exit `1` = a check failed/cancelled → do **not** merge; investigate. Exit `2` = timed out still pending → re-run or inspect the stuck job. This replaces the fragile hand-tuned `for … sleep …` poll loop (#317). Do not proceed to step 2 unless `ci:wait` exited `0`. (Memory `feedback_phase0_merge_gate_manual`.)

**Step 2 — merge.** Once step 1 is green, run exactly one command:

```bash
gh pr merge <N> --auto --squash --delete-branch
```

`--auto`/`--squash`/`--delete-branch` is the canonical merge command per ADR-0008 §2.6 (server-side branch protection is the target-state contract, deferred while on GitHub Free + private). `--auto` is harmless once step 1 is already green and keeps the command canonical; `--squash` enforces linear history; `--delete-branch` cleans up the head branch. **`--auto` is not a substitute for step 1** — it does not block on CI here.

Per ADR-0007 §2.4 + §2.10: a positive Mode (a) or Mode (b) verdict + green CI is sufficient to merge. **Human-merge is not required.** Mode (c) reviews remain a single human decision.

**Step 2a — merging from a git worktree (AGENTS.md §6 worktree-per-session).** When the PR branch lives in a `.claude/worktrees/<N>` worktree, `gh pr merge … --delete-branch` **errors on its local cleanup** — `fatal: 'main' is already used by worktree at <primary>` — because it tries to check `main` out locally while the primary tree holds it. **The remote squash-merge still succeeds**; only the local branch deletion fails. So:

1. Confirm the merge landed: `gh pr view <N> --json state,mergedAt` → `state:MERGED`, `mergedAt` set.
2. The **remote** branch is already deleted by `--delete-branch`; verify `git ls-remote --heads origin <branch>` is empty.
3. Clean the **local** squash-merged branch (it is not an ancestor of `main`, so `-d` refuses): `git fetch origin --prune` then `git branch -D <branch>`.
4. Tear the worktree down: `pnpm worktree:teardown .claude/worktrees/<N> --branch <branch>` (long-path-safe, #335) — or `node tools/dev/worktree-teardown.mjs <path>`.

**Before the first edit in a worktree (the trap #359 itself prevents):** `EnterWorktree` (or `git worktree add`) moves the cwd but does NOT redirect **absolute** paths — an absolute MAIN-tree path (`C:/Users/.../ds-platform/...`) in Write/Edit silently lands in the **shared main tree**, not the worktree, and any green observed there is a green against a non-isolated checkout (not a real green, `feedback_no_workarounds_build_clean`). Address files by **worktree-relative** or **`.claude/worktrees/<N>/…`** paths; sanity-check one path resolves under the worktree before editing; run tests/build **from** the worktree. If edits already leaked to main: copy them into the worktree, then `git restore` the tracked files + delete the new untracked ones in main — only after confirming `git status`/`git diff` shows the diff is exclusively yours. (memory `feedback_worktree_absolute_paths_escape_isolation`)

## Output

- PR merged into `main` (or queued for `--auto` merge once CI clears).
- Head branch deleted.

## Failure mode

- Any other merge command (`gh pr merge <N>` without `--auto`, with `--merge` instead of `--squash`, without `--delete-branch`, or `git push origin main` directly) is a process violation per ADR-0008 §2.6 (interim process-level merge contract).
- Invoking this skill while the latest review verdict is `REQUEST_CHANGES` or absent — process violation per `request-mode-a-review`'s `Cannot proceed without` clause.
