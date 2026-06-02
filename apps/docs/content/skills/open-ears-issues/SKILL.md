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
   gh label create "agent-ready" --color 0E8A16 --description "Ready for an AI agent to pick up"
   ```

   Closing G11 findings F-8 and F-19: do **not** silently substitute a generic label like `enhancement` when the project-specific label is missing. Either the label set is created up front, or `surface-decision-debt` is invoked to record the substitution as a follow-up.

2. **Open the parent Issue** (if not already open) with the feature milestone and link to `NNN-requirements.md`.
3. **For each EARS-N**, open a child Issue:

   ```bash
   gh issue create \
     --title "[NNN] EARS-N: <description>" \
     --milestone "NNN-<slug>" \
     --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
     --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
   ```

   Always pass `--body` — `gh issue create` without `--body`/`--body-file` opens an editor and hangs in non-interactive contexts. Fill the body's **Dependencies** field (`Blocked by:` / `Blocks:`) with the human-readable graph — prose alone is **not** sufficient; it must be backed by the native links set in step 4.

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

## Related skills

- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
