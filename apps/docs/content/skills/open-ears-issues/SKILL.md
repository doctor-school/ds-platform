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
- Extracted list of `EARS-N` requirements from `requirements.md`.

## Procedure

1. **Verify the label set exists.** Run `gh label list | grep -E 'feature:NNN-<slug>|kind:ears-handler|agent-ready'`. If any label is missing, create it before opening any Issue:

   ```bash
   gh label create "feature:NNN-<slug>" --color BFD4F2 --description "Feature NNN <slug>"
   gh label create "kind:ears-handler" --color D4C5F9 --description "Single EARS handler"
   gh label create "agent-ready" --color 0E8A16 --description "Ready for an AI agent to pick up"
   ```

   Closing G11 findings F-8 and F-19: do **not** silently substitute a generic label like `enhancement` when the project-specific label is missing. Either the label set is created up front, or `surface-decision-debt` is invoked to record the substitution as a follow-up.

2. **Open the parent Issue** (if not already open) with the feature milestone and link to `requirements.md`.
3. **For each EARS-N**, open a child Issue:

   ```bash
   gh issue create \
     --title "[NNN] EARS-N: <description>" \
     --milestone "NNN-<slug>" \
     --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
     --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
   ```

   Always pass `--body` — `gh issue create` without `--body`/`--body-file` opens an editor and hangs in non-interactive contexts.

4. **Record the Issue numbers** in the feature-branch commit message and add an `issues:` block to the `requirements.md` frontmatter (`issues: [N1, N2, N3, …]`).

## Output

- Parent Issue + N child Issues open.
- `requirements.md` frontmatter updated with the Issue numbers.

## Failure mode

- Substituting `enhancement` (or any other generic label) without a follow-up via `surface-decision-debt` — F-8 / F-19 pattern.
- Forgetting `--body` and letting the CLI hang — defensive fix at the call site.

## Related skills

- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
