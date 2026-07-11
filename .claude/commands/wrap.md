---
description: End-of-session wrap — independent retro → propose → apply+compact → repo/task hygiene → handoff.
---

# /wrap — end-of-session feedback-improvement + close-out loop

Drive the full end-of-session loop. The canonical procedure (with the failure
modes and the field detail) is the **`run-wrap`** catalog skill —
`apps/docs/content/skills/run-wrap/SKILL.md`. **Read it now**, then execute the
five stages below in order. Each stage **invokes an existing skill**; do not
re-implement any of them.

> Hard constraints (from epic #247 / #252 / #707): stage 1 fires only after
> **every in-flight dispatched agent has returned** and its bounded closeout ran
> (run-wrap Stage 0 — wait in all cases; premature retro = incomplete session);
> stage 1 is a **separate independent agent** (never self-review); stage 2's
> approval gate is **mandatory**; stage 3 must **compact, never just append**,
> and leave the anti-bloat budget green. Never stage or commit `.audit-tmp/`.

## 1. Retro — independent, single-session (dispatch)

**Stage 0 gate first (run-wrap §0):** enumerate live dispatched agents and wait
for every one to return — in all cases — before resolving the session id and
dispatching the retro.

Resolve the CURRENT session's log id, then dispatch `run-session-retro` in
single-session mode as a fresh-context **Opus** agent (independent — not
self-review).

1. **Resolve the session id (do this BEFORE dispatching).** The logs live at
   `~/.claude/projects/C--Users-sidor-repos-ds-platform/*.jsonl` (repo-root path
   with `[\\/:]`→`-`, the slug `tools/retro/extract.mjs` and
   `instruction-budget-lint.ts` use). The current session is the **newest-mtime**
   `*.jsonl`:

   ```bash
   ls -t ~/.claude/projects/C--Users-sidor-repos-ds-platform/*.jsonl | head -1
   ```

   Capture this id first — once the retro subagent starts it writes its own
   `*.jsonl` and could become newest-mtime. Pass the fixed `--session <id>` to the
   agent so it analyzes THIS session and skips its own log.

2. **Dispatch** an independent agent (Agent tool, `general-purpose` or `claude`,
   Opus) briefed with: the resolved `--session <id>`; the skill path
   `apps/docs/content/skills/run-session-retro/SKILL.md`; the instruction to run
   `tools/retro/extract.mjs` + `tools/retro/transcripts.mjs` in single-session
   mode and return **only** the corpus header + the findings array (the #248
   schema) + the consolidation note. A free-form narrative without the schema'd
   array is invalid — re-dispatch.

## 2. Propose — present edits, approval gate (mandatory)

From the findings, draft concrete instruction/memory edits (exact file + exact
change), favoring the `remedy_kind`: `prose-not-enforced` → a deterministic
skill/command/hook/lint-gate, not more prose; `cross-session-loss` → a memory
topic file + index line; `missing-rule` → an instruction line. Map each edit to
the finding it closes. **Present the full set to the user and STOP for approval.**
Nothing in stage 3 lands without an explicit go-ahead; carry forward only the
approved subset.

## 3. Apply + compact — never just append (budget-enforced)

On approval: apply the approved edits, then **compact** — relocate equal-or-more
detail OUT of the always-on core (long detail → `.claude/rules/*.md` with `paths:`
frontmatter, or a skill; settled facts → a `memory/<topic>.md` + a one-line
`MEMORY.md` index entry). Then run `pnpm lint:instruction-budget`; if any
always-on file is OVER BUDGET, compact further and re-run until **PASS**. The
session is not wrapped with a red budget. **Land the wrap's own edits via a
`tooling/`/`docs/` branch + PR — never leave them uncommitted in the shared main
tree** (a parallel session's `git add` sweeps a dangling instruction edit into
the wrong PR; auto-memory files under `~/.claude/.../memory/` save in place). The
wrap is not done while `git status` shows uncommitted repo-tracked instruction
files.

## 4. Repo/task hygiene (run-task-lifecycle §7 tail)

Invoke the `run-task-lifecycle` tail
(`apps/docs/content/skills/run-task-lifecycle/SKILL.md` §7) over the session's
outstanding work — do not restate it:

- Merge outstanding approved + green work autonomously (`merge-when-green`); don't
  wait for the human.
- `node tools/gh/set-board-status.mjs <N> "Done"` (alias `pnpm board:status`) for
  anything merged.
- Re-sweep: `gh pr list` + `git ls-remote --heads origin` (bot branches appear
  post-merge).
- **Stack/dependency updates** — check open Dependabot / `changeset-release/main`
  "Version Packages" PRs + stale pins; if something needs attention and has no
  tracking Issue, **file one with all fields** (kind, milestone, native
  blocked_by/blocks links, board Status) per `run-task-lifecycle` §1, then decide
  whether to take it next.
- Groom the next unblocked board item, or report the queue empty.

## 5. Handoff

Run the existing `handoff-prompt` skill to emit the next-session prompt. Do not
hand-roll the format — that skill owns it. Chunk the handoff's queue into waves
of **≤3 full PR-cycles** («this session: 1–3; next: 4–6») — never a flat ranked
list (run-wrap §5).
