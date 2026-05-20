---
title: "surface-decision-debt"
description: "Procedural skill (inline): reflect on the iteration's silent deviations from documented convention and open follow-up items. The list may be empty, but the invocation is required."
name: surface-decision-debt
mode: inline
---

# surface-decision-debt

**Kind:** procedural · **Mode:** inline.

## Input

- The lead agent's own iteration history — in-context recollection of decisions taken during RED / GREEN / REFACTOR / checklist runs.

## Procedure

1. **Explicit reflection.** Re-read your own session transcript (the current conversation) for moments where you took a decision that:
   - **Deviated from a documented convention** in an ADR or AGENTS.md without amending the convention.
   - **Substituted a generic label / convention** for a project-specific one because the project one wasn't set up (e.g., the `enhancement` for `feature:NNN-<slug>` pattern in G11 finding F-8).
   - **Skipped a checklist item** with a silent N/A that deserves a follow-up (e.g., "deferred glossary terms because no Keystatic UI yet").
   - **Made an architectural call** that the spec didn't pre-resolve (e.g., chose Vitest config layout pattern that the spec didn't dictate).
2. **For each item**, choose one of:
   - **Open a follow-up Issue** with label `decision-debt` and a clear title (`gh issue create --label decision-debt --title "..." --body "..."`).
   - **Open an ADR amendment task** via `do-adr-amendment` (if the deviation should retroactively become the convention).
   - **Log it in the iteration summary** with rationale (if the deviation is genuinely one-off and not worth tracking further).
3. **Return the list.** Either a list of opened follow-ups (with Issue numbers / amendment links) or an explicit empty list `[]`. The list goes into `write-iteration-summary`.

## Output

- A list of debt items (may be `[]`).
- Any opened Issues / amendment tasks are linked from the iteration summary.

## Failure mode

- **Skipping the skill entirely** — the F-19 / F-21 pattern. The agent moves from REFACTOR straight to push/PR/merge without ever reflecting on what was decided silently. That is the structural reason silent decisions accumulate into debt.
- Producing a list and forgetting to record it in `write-iteration-summary` — surfacing without persistence has the same end-state as not surfacing.
