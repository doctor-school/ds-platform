---
title: "run-wrap"
description: "Orchestration skill (inline): the /wrap end-of-session loop — dispatch an independent single-session retro → propose instruction/memory edits → on approval apply AND compact under the anti-bloat budget → repo/task hygiene → handoff. Orchestrates existing skills; never re-implements them. Invoked by .claude/commands/wrap.md."
name: run-wrap
mode: inline
---

# run-wrap

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure itself; stage 1 is the one **dispatch** step — a fresh-context retro agent).

This is the procedure behind the **`/wrap`** slash command ([`.claude/commands/wrap.md`](../../../../../.claude/commands/wrap.md)) — the capstone of epic #247's feedback-improvement loop: at end of session it turns the just-finished session's deviations into durable instruction/memory fixes, runs the task lifecycle to completion, and emits a handoff. It is **connective** — each stage **invokes an existing skill** and does not restate it. If a stage's detail is wrong, fix it in the owning skill.

> **This skill is the single source of the wrap procedure.** `.claude/commands/wrap.md` is only a thin entry pointer that says "read this skill and run it" — it carries no stage detail of its own, so the stages, gates, and failure modes below are never duplicated there (#758).

> **Cannot proceed without** — stage 0 has confirmed no dispatched agent is still in flight; stage 1 must return the schema'd findings array from an _independent_ agent (never self-review); stage 2's approval gate is mandatory before any edit lands; stage 3 must leave `pnpm lint:instruction-budget` green by **compacting**, never by appending.

## The stages

### 0. In-flight agent gate (before anything else)

Enumerate live dispatched agents — impl subagents, reviewers, background monitors. **Wait for every one to return — in all cases** — and run its bounded closeout (stand-ops/main-tree audit, Mode-a dispatch, tracker stop-state) **before** dispatching the stage-1 retro: a session error may be surfaced precisely by an in-flight agent's result, so a retro launched earlier analyzes an incomplete session and its findings miss the tail (owner directive 2026-07-10, #707). Recording the agent id + worktree/branch-DB/ports + relaunch recipe in the Issue stop-state and the handoff is the **fallback only** for a genuinely unreapable agent (harness-killed, no return possible) — never an alternative to waiting.

**DoD-vs-title gate.** Do NOT dispatch the retro / propose a wrap or handoff whose "remaining"/"next" list contains the SESSION'S OWN task-title verb (publish / release / deploy / ship) while no release tag or GitHub Deployment exists for THIS session — the prerequisite fix is not the deliverable (2026-07-15: #968's machinery fix was mislabeled "the cycle ran"; the actual publish+deploy was still undone). The enforced backstop is the completion-hook check tracked in the retro B+E tooling Issue.

### 1. Retro — independent, single-session (dispatch)

Dispatch [`run-session-retro`](../run-session-retro/SKILL.md) **in single-session mode** as an _independent, fresh-context_ agent, so the analysis is never self-review (the constraint the skill enforces). The agent returns the findings array in the #248 schema; consume it as the input to stage 2. Do not pin a vendor model in this procedure; select the reviewer-grade agent available in the active harness.

**Resolve and capture the current session id before dispatch** so the retro agent cannot accidentally analyze its own newer log. Branch by harness:

- **Claude Code:** resolve all `~/.claude/projects/*<repo-slug>*` segments by a session-unique task marker, not newest mtime; verify the id and marker, then run `extract.mjs` + `transcripts.mjs --session <id>`.
- **Codex:** use the active Codex session id with `node tools/retro/codex.mjs --session <id> --out-dir <work-dir>`. For an exported artifact use `--rollout <file>`; for a pre-normalized portable record use `--portable-input <file>`. The adapter emits `harness: codex` plus a versioned portable record and never presents a Codex rollout as a Claude transcript.

Before dispatch, inspect the generated `summary.json` and compact transcript for the expected task marker and `harness`. Brief the agent with the fixed id, harness command, and `run-session-retro` path.

**Token ledger (stage-1 input).** Run `pnpm retro:tokens <session-id>` and hand its output to the retro agent alongside the corpus: any subagent peak >200K or lead peak >300K is a deviation finding (category `context-budget`), cited from the ledger row. A wrap whose stage-1 input omits the ledger cannot surface over-budget dispatches at all. A free-form narrative without the schema'd findings array + corpus header + consolidation note is invalid — re-dispatch.

> The retro writes its digests into the gitignored `.audit-tmp/` (the extractor default). **Never** stage or commit `.audit-tmp/`.

### 2. Propose — present edits, mandatory approval gate

From the findings, draft **concrete** instruction/memory edits — the exact file + the exact change, not a vague intention. Favor what the finding's `remedy_kind` indicates: a `prose-not-enforced` root cause wants a deterministic `skill` / `command` / `hook` / `lint-gate`, not more prose; `cross-session-loss` wants a memory topic file + index line; `missing-rule` may warrant an instruction line. Map each edit back to the finding it closes.

**Issue-shaped proposals route through the significance threshold FIRST (AGENTS.md §6).** A finding whose remedy is a new tracker Issue (a `tooling`/`command`/`lint-gate` follow-up the wrap itself won't implement) is classified against the §6 threshold **before** it reaches the proposal list: below threshold (blocks no product deliverable, not user-visible/prod-risk, not release-gating) → propose a **`DEBT.md` line** (landed by the stage-3 wrap PR), never an Issue; above threshold → the Issue proposal **names which criterion it meets** and carries `source:retro`. A wrap that proposes an Issue without a named criterion is the exact inflation pattern the threshold exists to stop (owner-reported, 2026-07-16).

Present the full edit set to the user and **stop for approval**. This gate is mandatory (#252 design note) — nothing in stage 3 lands without an explicit go-ahead. If the user trims or rejects items, carry only the approved subset forward.

### 3. Apply + compact — never just append (budget-enforced)

On approval:

1. **Apply** the approved edits. When the bootstrap flags live parallel sessions, the wrap's own repo-tracked instruction/memory edits are **worktree-first from the first edit** (never edit-on-main-then-relocate); auto-memory files under `~/.claude` are exempt — saved in place.
2. **Compact, don't grow.** Every always-on file (`AGENTS.md`, `CLAUDE.md`, the path-less `.claude/rules/*.md`, and the `MEMORY.md` index) has a hard budget (200 lines / 25 KB — `tools/lint/instruction-budget-lint.ts`, #250). When an edit adds signal, relocate equal-or-greater detail **out** of the always-on core: long detail → `.claude/rules/*.md` (add `paths:` frontmatter to make it lazy/file-scoped) or a skill; a settled fact → a `memory/<topic>.md` file with a one-line `MEMORY.md` index entry. Appending without relocating is a banned outcome.
3. **Enforce the budget** — run `pnpm lint:instruction-budget`. If any always-on file is **OVER BUDGET**, compact further (relocate detail per step 2) and re-run until it reports **PASS**. The session is not "wrapped" with a red budget. **Size the compaction in one pass, not a grind:** compute the current byte size and the target delta up front, then do a single budget-sized rewrite — not iterative trim-then-`wc -c` loops (each em-dash/Cyrillic char is multi-byte, so byte convergence by eye is slow and wasteful).
4. **Land the wrap's own edits — never leave them dangling.** The instruction/memory edits this wrap just applied are themselves changes that must be **committed**, not left uncommitted in the shared main tree where a parallel session's `git add` can sweep them into the wrong PR — the exact orphaned `.claude/rules/dev-stand.md` edit a prior `/wrap` left for the next session to rescue (`feedback_worktree_per_session_when_parallel`). Land them like any other change: a `tooling/`/`docs/` worktree + branch + PR (`merge-when-green`); auto-memory files under `~/.claude/projects/<slug>/memory/` are outside the repo and are saved in place, not committed. Before declaring the wrap done, `git status` MUST be clean of repo-tracked instruction files (`AGENTS.md`, `CLAUDE.md`, `.claude/**`, `apps/docs/content/skills/**`).

### 4. Repo/task hygiene (via run-task-lifecycle patterns)

Run the lifecycle tail from [`run-task-lifecycle`](../run-task-lifecycle/SKILL.md) §7 over the session's outstanding work — do not restate it, invoke its steps:

1. **Merge outstanding approved work** — any PR with a positive Mode (a)/(b) verdict + green CI merges autonomously ([`merge-when-green`](../merge-when-green/SKILL.md)); do not leave it "waiting for the human" (Theme A).
2. **Set board statuses** — `node tools/gh/set-board-status.mjs <N> "Done"` (alias `pnpm board:status`) for anything merged this session; `Closes #N` does not move the Projects v2 column.
3. **Re-sweep branches/PRs** — `gh pr list` + `git ls-remote --heads origin`; bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge. Also prune **local** dispatch-agent cruft: `git worktree prune`, then delete merged orphan `worktree-agent-*` refs — confirm each is an ancestor of `main` first (`git merge-base --is-ancestor <ref> main`) then `git branch -d`. These accumulate across sessions when subagent-dispatch teardown (memory `feedback_subagent_dispatch_teardown`) is missed; sweeping them here keeps the repo from carrying a growing pile of dangling refs.
4. **Check for stack / dependency updates** — look for open Dependabot PRs, an open `changeset-release/main` "Version Packages" PR, and stale pins. If something needs attention and has no tracking Issue, **route it through the significance threshold (AGENTS.md §6)**: above threshold (blocks/critical-path of a product deliverable, user-visible or prod risk, or must act before the next release) → **file an Issue with every field complete** (kind label, exactly one `source:*` label — `source:retro` for a wrap-surfaced finding, milestone, native `blocked_by`/`blocks` links, board Status) per `run-task-lifecycle` §1 — then decide whether to take it next; **below threshold → append a `DEBT.md` line, not a new Issue** (the ledger is the owner's weekly/milestone triage surface).
5. **Deploy checkpoint** — if the session merged product PRs, check the **merged-not-deployed** delta in `## Project reality` (`pnpm bootstrap`). A non-empty delta means live prod is behind `main`: either run `/deploy` (skill `run-prod-deploy`) now, or record the pending-deploy delta explicitly in the stage-5 handoff so the next session ships it. Never let merged product work silently sit undeployed.
6. **Groom next** — surface the next unblocked board item (resume → rework → fresh → unblock ordering), or report the queue empty.

### 5. Handoff

Run the catalog [`handoff-prompt`](../handoff-prompt/SKILL.md) skill to emit the copy-pasteable next-session prompt. It is harness-neutral and owns the ≤300-token fixed shape. Do not hand-roll or substitute a vendor-global skill. Its first line carries the literal `pnpm handoff:verify` directive, so the resume-side gate travels with the artifact.

The handoff cites only document paths that exist at emit time (stat/`Read` each before including) and carries the canonical tracker id (GitHub Issue / Plane item) of the next task; «where we stopped» premises come from tracker comments, not the session's memory of itself. **Premise gate (mandatory, #743):** write the draft handoff to a temp file and run `pnpm handoff:verify <file>` — any STALE row = fix the claim before emitting; this deterministic gate replaces the prose-only premise check. Resume side: an agent that cannot locate a cited document STOPS and asks the owner instead of substituting its own reading.

**The handoff's queue is chunked into ONE wave per session** — ≤3 sequential PR-cycles, or ≤5 independent parallel Issues when their touch sets do not overlap (AGENTS.md §6 subagent context budget) — («this session: items 1–3; next: 4–6») — never one flat ranked list: the wave cap (memory `feedback_wave_plan_by_touch_set`) must fire at handoff-authoring time, not after the next session has already over-dispatched (2026-07-11 retro: a flat 6-item queue produced 5 dispatches in 5 minutes and 6 PR-cycles in one session). The dispatch-time counterpart is item 0 of memory `feedback_orchestration_brief_full_lint_before_pr`.

## Output

- Stage 1: the schema'd findings array from an independent retro agent + the resolved session id it analyzed + the `pnpm retro:tokens` ledger.
- Stage 2: the proposed edit set, presented; user approval (or a trimmed subset).
- Stage 3: approved edits applied + compacted; `pnpm lint:instruction-budget` **PASS**.
- Stage 4: outstanding work merged, board statuses set, inventory re-swept, stack-update Issue filed if warranted, next item surfaced.
- Stage 5: the `handoff-prompt` block.

## Failure modes

- **Dispatching the retro over a still-running agent** — stage 0 waits for every dispatched agent in all cases; a premature retro analyzes an incomplete session (#707, owner-corrected 2026-07-10).
- **Self-reviewing the retro** — stage 1 must be a separate, independent agent (#252). The lead running the analysis itself is the banned shortcut.
- **Skipping the approval gate** — stage 2 is non-bypassable; no edit lands without explicit approval.
- **Appending instead of compacting** — stage 3 must leave the budget green by relocating detail, not by growing the always-on core (#250 / epic #247 root-cause "context-bloat").
- **Stopping hygiene short of merge→Done→groom** — stage 4 runs the `run-task-lifecycle` §7 tail to completion (Theme A).
- **Re-implementing an orchestrated skill here** — every stage invokes the owning skill; this skill is connective by design.

## Related skills

- [../run-session-retro/SKILL.md](../run-session-retro/SKILL.md) — the retro analysis engine (stage 1, dispatched independent).
- [../run-task-lifecycle/SKILL.md](../run-task-lifecycle/SKILL.md) — the hygiene/merge/board/groom tail (stage 4).
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md) — the single merge command (stage 4.1).
- [../handoff-prompt/SKILL.md](../handoff-prompt/SKILL.md) — the portable next-session prompt (stage 5).

Helpers: `tools/retro/extract.mjs` + `transcripts.mjs` (Claude corpus), `tools/retro/codex.mjs` (Codex/portable corpus); `tools/lint/instruction-budget-lint.ts` / `pnpm lint:instruction-budget` (stage 3 budget); `tools/gh/set-board-status.mjs` / `pnpm board:status` (stage 4 board).
