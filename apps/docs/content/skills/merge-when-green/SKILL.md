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

**Step 0 — conflict pre-check (before ANY CI wait).** `gh pr view <N> --json mergeStateStatus -q .mergeStateStatus`. **`DIRTY` = merge conflict with base ⇒ GitHub cannot build the `pull_request` merge-ref, so CI will never start on the current head** — do NOT wait/poll for checks (a 20-minute poll on #606 waited for a run that could not exist). Rebase + resolve + `git push --force-with-lease` first, then enter Step 1 on the new head. Orchestration corollary: when sequential PRs touch the same module, rebase the trailing PR **immediately after** the leading one merges — don't discover the conflict at merge time. (`DIRTY` is a reliable signal here; `BEHIND` is not — see Step 1a.)

**Step 1 — confirm CI green via the deterministic merge gate (Phase-0 manual gate).** In Phase 0 the repo is GitHub Free + private, so there is **no server-side required-checks gate**: `--auto` does **not** hold the merge for CI — it merges the instant an approval exists, even while checks are still pending (this is what merged L1 #278 ahead of a pending CI). So the real gate is manual, and its **single sanctioned mechanical form** is the merge gate (#836):

```bash
pnpm merge:gate <N>   # node tools/gh/merge-gate.mjs <N> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>]
```

It is a bounded FOREGROUND poll pinned to the PR **head SHA**, ending in a mandatory terminal `GREEN`/`RED`/`TIMEOUT` line, and it closes the two watcher gaps that made ad-hoc `gh pr checks --watch`/grep loops unsafe (retro 29f490ed): **zero registered check-runs is a FAIL, not a green** (a watch started seconds after a push sees an empty board for the new SHA — the gate waits for registration, default 180s, then goes RED); verdicts come from structured `status`/`conclusion` fields, **never from grepping check names** (a job named `submit-pending` must not read as pending); a green board is re-pinned against the head SHA (a head that moved mid-poll is RED); and it enforces the worktree guard mechanically — it refuses to run from a `.claude/worktrees/*` cwd or while the PR branch is checked out in a registered worktree, naming `pnpm worktree:teardown <N>` (exit `4`, see Step 2/2a). Exit `0` = GREEN → proceed to step 1a. Exit `1` = RED (failed/cancelled run, zero-runs race, or head moved) → do **not** merge; investigate. Exit `2` = TIMEOUT still pending → re-run or inspect the stuck job. Do not proceed unless the gate printed `GREEN` and exited `0`. Hand-rolled poll loops and the older `pnpm ci:wait` watcher are **not** substitutes — they gate neither the head SHA nor registration nor the worktree cwd. (Memory `feedback_phase0_merge_gate_manual`.)

**Step 1a — base-freshness check (parallel sessions).** Green CI on this PR only proves the branch is green **against the base it last built on** — and Phase 0 has **no server-side up-to-date gate** (branch protection is deferred on GitHub Free + private, repo-conventions → _Branch protection_). So if a **parallel session merged into `main`** after this branch's checks ran, that green is stale: it was observed against an old `main`. Check base ancestry directly (do **not** use `gh pr view --json mergeStateStatus` for this — GitHub reports `BEHIND` only when server-side "require branches to be up to date" protection is active, which this repo defers, so a stale branch here reads `CLEAN`/`UNSTABLE` and the signal never fires; verified live on #430/#431):

```bash
git fetch origin -q
git merge-base --is-ancestor "$(git rev-parse origin/main)" \
  "$(gh pr view <N> --json headRefOid -q .headRefOid)" && echo fresh || echo STALE
```

`fresh` (origin/main is an ancestor of the PR head) → proceed to Step 2. `STALE` → the green CI ran against an old `main`; rebase, re-push, and re-verify **before** merging:

```bash
git fetch origin && git rebase origin/main
git push --force-with-lease
pnpm ci:wait <N>   # must exit 0 again on the rebased head
```

Only once the rebased head is green (and the ancestry check says `fresh`) proceed to Step 2. **Precedent:** two parallel branches cut off a pre-merge base each added the same dependency; the second to merge carried a `pnpm-lock.yaml` generated against the old tree, and the `setup` job went red on `main` post-merge (#218, memory `feedback_rebase_parallel_branches_for_lockfile`). The ancestry check catches exactly this class before it lands.

**Step 1b — Stage-B pre-merge gate (user-facing PRs).** For a `user-facing` surface the rendered result must be re-confirmed by the product owner on the LIVE stand before merge, and an unanswered Stage-B question BLOCKS the merge (AGENTS.md §6). Run the deterministic gate against the live PR right before merging:

```bash
pnpm pr:preflight <N> --pre-merge   # runs the stage-b guard (#692) + re-runs the merge gate (#836)
```

(The `--pre-merge` sweep re-runs `merge:gate` after the stage-b guard — on a board Step 1 already saw terminal it re-confirms in one poll, so the second pass is cheap and re-pins the head SHA right before the merge.)

Exit `0` = the PR touches no user-facing render surface, OR it carries a recorded `Stage-B: GO` / `Stage-B: batched at #<gate>` in the PR body or a linked-Issue comment → proceed to Step 2. Exit `1` = a user-facing PR with no Stage-B record → do **NOT** merge: get (and record) the owner's live verdict first. This is the mechanical enforcement of the passive §6 rule the 006 room slice (#691) slipped through — the guard is WARN-first (ADR-0007 §2.6) but the merge procedure treats a non-zero pre-merge gate as blocking. (The batched-gate carve-out: a child PR under an epic's batched Stage-B Issue records `Stage-B: batched at #<gate>` and passes.)

**Step 2 — merge via the single mandatory command.** Once step 1 is green, step 1a says `fresh`, and step 1b passed: **if you are inside a worktree, first return to the main tree** (`ExitWorktree action:keep`, or `cd` to the primary tree) — an ordered pre-merge step, not a preference, because `--delete-branch`'s local cleanup fails from inside the worktree (it recurred on BOTH PRs of one session, 2026-07-12; the merge gate now refuses mechanically, exit `4`). Then run exactly one command — the wrapper that runs the gate as a **real barrier** and merges only on green:

```bash
pnpm merge:when-green <N>   # node tools/gh/merge-when-green.mjs <N> — gate (own statement) → gh pr merge --squash --delete-branch ONLY on exit 0
```

`merge:when-green` runs `merge:gate <N>` as its **own statement**, checks the gate's exit code **explicitly**, and spawns `gh pr merge <N> --squash --delete-branch` **only** when the gate exited `0` (GREEN); a RED / TIMEOUT / worktree-refusal gate exit is propagated and **no merge is attempted**. **Do NOT hand-chain the gate into the merge** — neither `pnpm merge:gate <N> && gh pr merge …` nor, worse, any **piped** form (`pnpm merge:gate <N> | tail && gh pr merge …`): a pipe makes the shell observe the **pipe's** exit status (`tail`'s `0`), not the gate's, so a RED gate cannot block the `&&`-chained merge — the #928 root cause the wrapper exists to remove. If you must run the raw `gh pr merge <N> --squash --delete-branch` (e.g. a bot branch with no CI, repo-conventions → _Version-Packages release PR_), it is invoked **on its own**, never downstream of a piped gate.

`--squash`/`--delete-branch` is the **Phase-0 operational** merge command: `--squash` enforces linear history, `--delete-branch` cleans up the head branch. **Do not add `--auto` in Phase 0** — on GitHub Free `--auto` is rejected with `Pull request is in clean status` once the PR is already clean-green (auto-merge cannot be queued for a PR that could merge now — observed #798, 2026-07-12), and where it is accepted it does **not** block on CI (it once merged #62 into a red aggregate). `--auto --squash --delete-branch` is the ADR-0008 §2.6 **target-state** command for when server-side branch protection is reactivated — not the Phase-0 command (memory `feedback_phase0_merge_gate_manual`).

Per ADR-0007 §2.4 + §2.10: a positive Mode (a) or Mode (b) verdict + green CI is sufficient to merge. **Human-merge is not required.** Mode (c) reviews remain a single human decision.

**Step 2a — merging from a git worktree (AGENTS.md §6 worktree-per-session).** Step 2's ordered pre-merge action is to **return to the MAIN tree before merging** (`ExitWorktree action:keep`, or `cd` to the primary tree) — merging from `main` sidesteps the local-cleanup error and the follow-up re-verify entirely. If you nonetheless merge from inside the worktree: `gh pr merge … --delete-branch` **errors on its local cleanup** — `fatal: 'main' is already used by worktree at <primary>` — because it tries to check `main` out locally while the primary tree holds it. **The remote squash-merge still succeeds**; only the local branch deletion fails. Either way:

1. Confirm the merge landed: `gh pr view <N> --json state,mergedAt` → `state:MERGED`, `mergedAt` set.
2. The **remote** branch is already deleted by `--delete-branch`; verify `git ls-remote --heads origin <branch>` is empty.
3. Clean the **local** squash-merged branch (it is not an ancestor of `main`, so `-d` refuses): `git fetch origin --prune` then `git branch -D <branch>`.
4. Tear the worktree down: `pnpm worktree:teardown .claude/worktrees/<N> --branch <branch>` (long-path-safe, #335) — or `node tools/dev/worktree-teardown.mjs <path>`. Then **assert it is gone**: run `git worktree list` and confirm the merged branch's worktree is absent — the merge is not complete until this assertion passes. A surviving worktree of a squash-merged branch becomes a false "incomplete work" signal for later sessions/recovery (2026-07-11 retro: a stale `.claude/worktrees/584` misled disaster-recovery for ~15 min).
5. **Keep the live URL alive (if the owner reviews it on the stand).** Tearing the worktree down kills any dev server you booted from it, so a `localhost` URL you handed for review goes dead. If the work exposes a live-verify surface the owner opens, **(re)boot it from the `main` tree** after teardown (`git merge --ff-only origin/main` first, then the app's `dev` script) and leave it up — never hand a dead `localhost`, and don't kill→reboot per merge (boot from `main` once the branch has landed). The stand stays up until the owner's review concludes (`feedback_live_url_not_screenshots`).

**Committing from a fresh worktree (docs/IaC-only).** A just-created worktree has no `node_modules`, so the `lint-staged` pre-commit hook fails (`'lint-staged' is not recognized`). For a **docs/config/IaC-only** branch, `git commit --no-verify` is the expected path — log the reason in the PR body (the repo-conventions escape hatch). This is a sanctioned escape hatch, **not** a banned workaround. But `--no-verify` also skips Prettier, and Prettier **gates** md/json/yaml/css on CI (`reference_prettier_not_ts_gate`) — so **pre-format the changed files with the MAIN tree's prettier binary** before committing, else the PR lands with a red `format` check + rerun:

```bash
node <main-tree>/node_modules/prettier/bin/prettier.cjs --write \
  .claude/worktrees/<N>/path/to/changed.md  # …md/json/yaml/css only; .env/.ts are not prettier-gated
```

Run `pnpm install` in the worktree only when the task touches code that needs the hook (compile/typecheck/tests).

**Before the first edit in a worktree (the trap #359 itself prevents):** `EnterWorktree` (or `git worktree add`) moves the cwd but does NOT redirect **absolute** paths — an absolute MAIN-tree path (`C:/Users/.../ds-platform/...`) in Write/Edit silently lands in the **shared main tree**, not the worktree, and any green observed there is a green against a non-isolated checkout (not a real green, `feedback_no_workarounds_build_clean`). Address files by **worktree-relative** or **`.claude/worktrees/<N>/…`** paths; sanity-check one path resolves under the worktree before editing; run tests/build **from** the worktree. If edits already leaked to main: copy them into the worktree, then `git restore` the tracked files + delete the new untracked ones in main — only after confirming `git status`/`git diff` shows the diff is exclusively yours. (memory `feedback_worktree_absolute_paths_escape_isolation`)

## Output

- PR merged into `main`.
- Head branch deleted.

## Failure mode

- Any other merge command (`--merge` instead of `--squash`, omitting `--delete-branch`, adding `--auto` in Phase 0, or `git push origin main` directly) is a process violation per ADR-0008 §2.6 (interim process-level merge contract).
- Invoking this skill while the latest review verdict is `REQUEST_CHANGES` or absent — process violation per `request-mode-a-review`'s `Cannot proceed without` clause.
