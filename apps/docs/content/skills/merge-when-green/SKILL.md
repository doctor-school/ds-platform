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

## Output

- PR merged into `main` (or queued for `--auto` merge once CI clears).
- Head branch deleted.

## Failure mode

- Any other merge command (`gh pr merge <N>` without `--auto`, with `--merge` instead of `--squash`, without `--delete-branch`, or `git push origin main` directly) is a process violation per ADR-0008 §2.6 (interim process-level merge contract).
- Invoking this skill while the latest review verdict is `REQUEST_CHANGES` or absent — process violation per `request-mode-a-review`'s `Cannot proceed without` clause.
