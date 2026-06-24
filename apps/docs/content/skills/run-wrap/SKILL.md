---
title: "run-wrap"
description: "Orchestration skill (inline): the /wrap end-of-session loop — dispatch an independent single-session retro → propose instruction/memory edits → on approval apply AND compact under the anti-bloat budget → repo/task hygiene → handoff. Orchestrates existing skills; never re-implements them. Invoked by .claude/commands/wrap.md."
name: run-wrap
mode: inline
---

# run-wrap

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure
itself; stage 1 is the one **dispatch** step — a fresh-context retro agent).

This is the procedure behind the **`/wrap`** slash command
([`.claude/commands/wrap.md`](../../../../../.claude/commands/wrap.md)). It is
the capstone of epic #247's feedback-improvement loop: at end of session it turns
the just-finished session's deviations into durable instruction/memory fixes,
runs the task lifecycle to completion, and emits a handoff. It is **connective** —
each stage **invokes an existing skill** and does not restate it. If a stage's
detail is wrong, fix it in the owning skill.

> **Cannot proceed without** — stage 1 must return the schema'd findings array
> from an _independent_ agent (never self-review); stage 2's approval gate is
> mandatory before any edit lands; stage 3 must leave `pnpm lint:instruction-budget`
> green by **compacting**, never by appending.

## The five stages

### 1. Retro — independent, single-session (dispatch)

Dispatch [`run-session-retro`](../run-session-retro/SKILL.md) **in single-session
mode** as an _independent_ Opus agent, so the analysis is never self-review (the
constraint the skill enforces). The agent returns the findings array in the #248
schema; consume it as the input to stage 2.

**Resolve the current session's log id first** — pass it to the retro agent so it
analyzes _this_ session, not the whole corpus:

- The logs live in `~/.claude/projects/<repo-slug>/*.jsonl`, where `<repo-slug>`
  is the repo-root path with `[\\/:]` replaced by `-` (the same slug
  `tools/retro/extract.mjs` → `defaultLogDir()` and
  `tools/lint/instruction-budget-lint.ts` → `memoryPath()` derive). On this box:
  `C--Users-sidor-repos-ds-platform`.
- Pick the **newest-mtime `*.jsonl`** in that dir — that is the session running
  `/wrap`. Resolve it deterministically, e.g.:

  ```bash
  ls -t ~/.claude/projects/C--Users-sidor-repos-ds-platform/*.jsonl | head -1
  ```

- **Exclude the dispatched retro agent's own log.** A subagent writes its own
  `*.jsonl`; once dispatched it can become newest-mtime. So **capture the id
  BEFORE dispatching** the retro agent (resolve newest-mtime first, then dispatch
  with that fixed `--session <id>`). The retro agent must also skip its own log —
  it is given the explicit id, so it never globs.

Brief the agent with: the resolved `--session <id>`, the `run-session-retro`
SKILL.md path, and the instruction to run `tools/retro/extract.mjs` +
`transcripts.mjs` in single-session mode and return **only** the findings array +
corpus header + consolidation note (the skill's mandatory output). A free-form
narrative without the schema'd array is not a valid return — re-dispatch.

> The retro writes its digests into the gitignored `.audit-tmp/` (the extractor
> default). **Never** stage or commit `.audit-tmp/`.

### 2. Propose — present edits, mandatory approval gate

From the findings, draft **concrete** instruction/memory edits — the exact file +
the exact change, not a vague intention. Favor what the finding's `remedy_kind`
indicates: a `prose-not-enforced` root cause wants a deterministic
`skill` / `command` / `hook` / `lint-gate`, not more prose; `cross-session-loss`
wants a memory topic file + index line; `missing-rule` may warrant an instruction
line. Map each edit back to the finding it closes.

Present the full edit set to the user and **stop for approval**. This gate is
mandatory (#252 design note) — nothing in stage 3 lands without an explicit
go-ahead. If the user trims or rejects items, carry only the approved subset
forward.

### 3. Apply + compact — never just append (budget-enforced)

On approval:

1. **Apply** the approved edits.
2. **Compact, don't grow.** Every always-on file
   (`AGENTS.md`, `CLAUDE.md`, the path-less `.claude/rules/*.md`, and the
   `MEMORY.md` index) has a hard budget (200 lines / 25 KB —
   `tools/lint/instruction-budget-lint.ts`, #250). When an edit adds signal,
   relocate equal-or-greater detail **out** of the always-on core: long detail →
   `.claude/rules/*.md` (add `paths:` frontmatter to make it lazy/file-scoped) or
   a skill; a settled fact → a `memory/<topic>.md` file with a one-line
   `MEMORY.md` index entry. Appending without relocating is a banned outcome.
3. **Enforce the budget** — run `pnpm lint:instruction-budget`. If any always-on
   file is **OVER BUDGET**, compact further (relocate detail per step 2) and
   re-run until it reports **PASS**. The session is not "wrapped" with a red
   budget.

### 4. Repo/task hygiene (via run-task-lifecycle patterns)

Run the lifecycle tail from [`run-task-lifecycle`](../run-task-lifecycle/SKILL.md)
§7 over the session's outstanding work — do not restate it, invoke its steps:

1. **Merge outstanding approved work** — any PR with a positive Mode (a)/(b)
   verdict + green CI merges autonomously ([`merge-when-green`](../merge-when-green/SKILL.md));
   do not leave it "waiting for the human" (Theme A).
2. **Set board statuses** — `node tools/gh/set-board-status.mjs <N> "Done"`
   (alias `pnpm board:status`) for anything merged this session; `Closes #N` does
   not move the Projects v2 column.
3. **Re-sweep branches/PRs** — `gh pr list` + `git ls-remote --heads origin`;
   bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear
   post-merge. Also prune **local** dispatch-agent cruft: `git worktree prune`, then
   delete merged orphan `worktree-agent-*` refs — confirm each is an ancestor of
   `main` first (`git merge-base --is-ancestor <ref> main`) then `git branch -d`.
   These accumulate across sessions when subagent-dispatch teardown (memory
   `feedback_subagent_dispatch_teardown`) is missed; sweeping them here keeps the
   repo from carrying a growing pile of dangling refs.
4. **Check for stack / dependency updates** — look for open Dependabot PRs, an
   open `changeset-release/main` "Version Packages" PR, and stale pins. If
   something needs attention and has no tracking Issue, **file one with every
   field complete** (kind label, milestone, native `blocked_by`/`blocks` links,
   board Status) per `run-task-lifecycle` §1 — then decide whether to take it
   next.
5. **Groom next** — surface the next unblocked board item (resume → rework →
   fresh → unblock ordering), or report the queue empty.

### 5. Handoff

Run the existing `handoff-prompt` skill (a global Claude Code skill, triggers on
`/handoff-prompt`) to emit the copy-pasteable next-session prompt. Do not
hand-roll the handoff format — `handoff-prompt` owns it (≤ 300 tokens, fixed
section template).

## Output

- Stage 1: the schema'd findings array from an independent retro agent + the
  resolved session id it analyzed.
- Stage 2: the proposed edit set, presented; user approval (or a trimmed subset).
- Stage 3: approved edits applied + compacted; `pnpm lint:instruction-budget`
  **PASS**.
- Stage 4: outstanding work merged, board statuses set, inventory re-swept,
  stack-update Issue filed if warranted, next item surfaced.
- Stage 5: the `handoff-prompt` block.

## Failure modes

- **Self-reviewing the retro** — stage 1 must be a separate, independent agent
  (#252). The lead running the analysis itself is the banned shortcut.
- **Skipping the approval gate** — stage 2 is non-bypassable; no edit lands
  without explicit approval.
- **Appending instead of compacting** — stage 3 must leave the budget green by
  relocating detail, not by growing the always-on core (#250 / epic #247
  root-cause "context-bloat").
- **Stopping hygiene short of merge→Done→groom** — stage 4 runs the
  `run-task-lifecycle` §7 tail to completion (Theme A).
- **Re-implementing an orchestrated skill here** — every stage invokes the owning
  skill; this skill is connective by design.

## Related skills

- [../run-session-retro/SKILL.md](../run-session-retro/SKILL.md) — the retro
  analysis engine (stage 1, dispatched independent).
- [../run-task-lifecycle/SKILL.md](../run-task-lifecycle/SKILL.md) — the
  hygiene/merge/board/groom tail (stage 4).
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md) — the single merge
  command (stage 4.1).
- `handoff-prompt` (global skill) — the next-session prompt (stage 5).

Helpers: `tools/retro/extract.mjs` + `transcripts.mjs` (stage 1 corpus);
`tools/lint/instruction-budget-lint.ts` / `pnpm lint:instruction-budget` (stage 3
budget); `tools/gh/set-board-status.mjs` / `pnpm board:status` (stage 4 board).
