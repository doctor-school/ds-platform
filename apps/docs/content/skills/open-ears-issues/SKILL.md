---
title: "open-ears-issues"
description: "Procedural skill (inline): open one GitHub Issue per EARS-N requirement in a feature spec; create the label set if missing."
name: open-ears-issues
mode: inline
---

# open-ears-issues

**Kind:** procedural · **Mode:** inline.

## Input

- Feature-spec path `apps/docs/content/specs/features/NNN-<slug>/`.
- Extracted list of `EARS-N` requirements from `NNN-requirements.md`.

## Procedure

1. **Verify the label set exists.** Run `gh label list | grep -E 'feature:NNN-<slug>|kind:ears-handler|agent-ready'`. If any label is missing, create it before opening any Issue:

   ```bash
   gh label create "feature:NNN-<slug>" --color BFD4F2 --description "Feature NNN <slug>"
   gh label create "kind:ears-handler" --color D4C5F9 --description "Single EARS handler"
   gh label create "kind:integration" --color D4C5F9 --description "Vertical-slice / integration work (not a single EARS handler)"
   gh label create "agent-ready" --color 0E8A16 --description "Ready for an AI agent to pick up"
   ```

   Closing G11 findings F-8 and F-19: do **not** silently substitute a generic label like `enhancement` when the project-specific label is missing. Either the label set is created up front, or `surface-decision-debt` is invoked to record the substitution as a follow-up.

2. **Open the parent Issue** (if not already open) under the product-theme milestone (AGENTS.md §2 — e.g. `Auth foundations v1`, not a per-spec name) and link to `NNN-requirements.md`. The spec folder is bound to the work by the `feature:NNN-<slug>` label, not the milestone.
3. **For each EARS-N**, open a child Issue:

   ```bash
   gh issue create \
     --title "[NNN] EARS-N: <description>" \
     --milestone "<product-theme milestone>" \
     --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
     --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
   ```

   Always pass `--body` — `gh issue create` without `--body`/`--body-file` opens an editor and hangs in non-interactive contexts. Fill the body's **Dependencies** field (`Blocked by:` / `Blocks:`) with the human-readable graph — prose alone is **not** sufficient; it must be backed by the native links set in step 4.

3a. **Open integration / vertical-slice Issues — `surface: user-facing` specs only** (closing F-22). The "1 EARS = 1 child Issue" rule of step 3 covers **handlers only**; for a `user-facing` spec it mechanically produces a backend-only Issue set (this is exactly how 003 left the portal forms unowned). Read the spec's `surface:` frontmatter:

- **`surface: backend-only`** → skip this step; the handler Issues are the complete WBS.
- **`surface: user-facing`** → for every user-facing slice that **no handler Issue owns** (the form/page existence, the request→enter-code two-step UX, error display, redirect-after-auth, the portal↔BFF wiring), open an **integration Issue** with `kind:integration` (not `kind:ears-handler`) and the browser/E2E acceptance baked into its AC. If the slice is a **named** out-of-scope deferral from the spec, open a tracked follow-up Issue for it rather than leaving it implicit. Wire it into the native graph in step 4 like any child. A scaffold/stub whose code comment promises future wiring ("wired in F2/F3") **MUST** have a corresponding open Issue — a code comment is not a tracked obligation. **Batched-UI slices are re-cut at open time (the #595 lesson):** when the handler children are expected to merge backend-only with «Stage-B: batched at #NNN», the batched slice Issue MUST itself be decomposed into separate children by deliverable class — the surface wiring (Refine/portal UI), the browser-E2E journey, and any cross-cutting test suites — never one Issue folding them all into a single unit of work (one such combined brief consumed >1h / ~465K tokens in a single subagent, 2026-07-08; memory `feedback_decompose_integration_slices_before_dispatch`).

4. **Wire the native relationships** (mandatory — prose in the body is not machine-readable, and the board ordering procedure reads only the native graph). Two relationship types, set via the GitHub REST API through `gh api`:
   - **Sub-issue hierarchy** — attach every child as a sub-issue of the parent.
   - **Blocked-by / blocking** — set the dependency edges between children (and on the parent where it applies).

   Both endpoints take the target's **numeric database id** (not the issue number) — `gh api repos/$OWNER/$REPO/issues/<n> --jq .id`. Resolve the ids once (a `number → id` lookup); avoid a fresh round-trip per edge when wiring a whole set.

   ```bash
   OWNER=doctor-school; REPO=ds-platform                     # set once; reused by every call below
   id() { gh api "repos/$OWNER/$REPO/issues/$1" --jq .id; }  # number → DB id

   # Attach child #C as a sub-issue of parent #P (sub_issue_id = DB id of #C):
   gh api --method POST "repos/$OWNER/$REPO/issues/<P>/sub_issues" -F sub_issue_id="$(id <C>)"

   # Mark child #B as blocked by #A (issue_id = DB id of #A, the blocker):
   gh api --method POST "repos/$OWNER/$REPO/issues/<B>/dependencies/blocked_by" -F issue_id="$(id <A>)"
   ```

   GitHub derives the reciprocal edge automatically — setting `blocked_by` on #B makes #A "blocks" #B; do **not** double-wire the other direction. Verify with the read endpoints: `gh api repos/$OWNER/$REPO/issues/<P>/sub_issues` and `gh api repos/$OWNER/$REPO/issues/<B>/dependencies/blocked_by`. Worked example: 003's parent #80 + children #81–#90 are wired this way.

5. **Record the Issue numbers** in the feature-branch commit message and add an `issues:` block to the `NNN-requirements.md` frontmatter (`issues: [N1, N2, N3, …]`).

## Output

- Parent Issue + N child Issues open.
- Native links set: each child is a sub-issue of the parent, and the blocked-by graph is wired; every body's **Dependencies** field matches the native graph.
- `NNN-requirements.md` frontmatter updated with the Issue numbers.

## Failure mode

- Substituting `enhancement` (or any other generic label) without a follow-up via `surface-decision-debt` — F-8 / F-19 pattern.
- Forgetting `--body` and letting the CLI hang — defensive fix at the call site.
- Recording dependencies only as prose in the body and skipping the native links (step 4) — the board ordering procedure reads the native graph, so prose-only dependencies leave the operational surface blind. This is the gap #93 closes.
- Opening only handler Issues for a `surface: user-facing` spec and skipping step 3a — the user-facing slices (forms, wiring, browser E2E) stay unowned and the "five green features over a non-functional product" failure recurs. This is the F-22 gap (#132); precedent #131 had to be created retroactively for 003.

## Related skills

- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
