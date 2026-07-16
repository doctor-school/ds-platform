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
2. **For each item, classify it against the significance threshold (AGENTS.md §6)** — a tracker Issue ONLY when the debt (a) blocks / sits on the critical path of a product deliverable, (b) is user-visible or a prod risk (security/data), or (c) must be acted on before the next release — then route:
   - **Above threshold → open a follow-up Issue** with label `decision-debt` **and exactly one `source:*` provenance label** (`source:retro` for a ritual-surfaced item; `source:agent` if surfaced mid-execution; `source:owner` only with a quotable owner request) — `pnpm issue:create --label decision-debt --label source:retro --title "..." --body-file ...` (the wrapper refuses creation without the `source:*` label).
   - **Above threshold, convention should change → open an ADR-revision task** via `do-adr-revision` (if the deviation should retroactively become the convention).
   - **Below threshold → append ONE line to `DEBT.md`** (repo root, format documented in its header) — in the **same commit or same PR** as the work that surfaced it, never deferred.
   - **Log it in the iteration summary** with rationale (if the deviation is genuinely one-off and not worth tracking further — still a list item, routed nowhere).
3. **Return the list.** Either a list of surfaced items or an explicit empty list `[]` — **each item naming WHERE it was routed** (Issue #N / ADR-revision / `DEBT.md` line / summary-only, per the step-2 threshold). The two are mutually exclusive: **if the reflection names ANY deviation — even one judged benign or handled in-band — it MUST appear as a list item (option 2d at minimum); `[]` plus a prose "decision note" is invalid output**, because `[]` asserts nothing was decided silently while the note contradicts it. The list goes into `write-iteration-summary` (or the stop-state / result comment for non-iteration kinds).

## Output

- A list of debt items (may be `[]`), each naming its routing (Issue #N / ADR-revision / `DEBT.md` line / summary-only).
- Any opened Issues / amendment tasks are linked from the iteration summary; any `DEBT.md` lines land in the same commit/PR.

## Failure mode

- **Skipping the skill entirely** — the F-19 / F-21 pattern. The agent moves from REFACTOR straight to push/PR/merge without ever reflecting on what was decided silently. That is the structural reason silent decisions accumulate into debt.
- Producing a list and forgetting to record it in `write-iteration-summary` — surfacing without persistence has the same end-state as not surfacing.
- **Reporting `[]` while narrating a deviation in prose next to it** — the #471 stop-state pattern (an unratified artifact type noted as a "decision note" beside an empty list). The named deviation belongs in the list; the empty list is only for a genuinely deviation-free iteration.
