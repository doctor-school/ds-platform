---
title: "do-hotfix-pr"
description: "Orchestration skill: drive a code-level bugfix end-to-end. No feature-spec required."
name: do-hotfix-pr
mode: inline
---

# do-hotfix-pr

**Kind:** orchestration · **Mode:** inline.

> **Cannot proceed without** — `run-iteration-end-checklist` PASS verdict, `request-mode-a-review` APPROVE verdict, `surface-decision-debt` invocation (output may be `[]`). Same artifact-gated discipline as `do-feature-iteration`; the only flow difference is that EARS authoring + ADR re-reading are skipped by default.

## Input

- GitHub Issue `#N` with `bug` label and a reproducer or failing test attached.
- Branch name `fix/<N>-<slug>`.

## Procedure

1. **Failing test first** — reproduce the bug in a Vitest test (or, for CI/infra hotfixes, in the smallest possible artifact that demonstrates the failure — e.g., a workflow-syntax check).
2. **Fix** — minimum code change that turns the failing test green.
3. **`run-iteration-end-checklist`** (dispatch) — verdict-gated. Items that are N/A for a hotfix (spec status frontmatter, glossary, ADR, architecture/operations docs) are returned as `N/A` by the subagent, not silently skipped.
4. **`surface-decision-debt`** (inline) — required invocation.
5. `git push` + `gh pr create` (label `bug`, `Closes #N`, `author:*`).
6. **`request-mode-a-review`** (dispatch) — verdict-gated.
7. **`respond-to-review`** (inline) — loop until APPROVE + green CI.
8. **`write-iteration-summary`** (inline).
9. **`merge-when-green`** (inline).

Skipped vs `do-feature-iteration`:

- `read-relevant-adrs` is **not** invoked by default. If the bug touches an architectural boundary (e.g., the fix changes an HTTP contract or a DB constraint), explicitly invoke it and cite the relevant ADR section in the PR description.
- `author-ears-spec` and `open-ears-issues` are not part of this flow.

## Output

- PR merged, Issue `#N` closed, iteration summary published.

## Failure mode

- Fixing the symptom without a failing test that demonstrates the bug — TDD violation, hotfix without reproducer.
- Skipping a discipline gate — same as `do-feature-iteration`.

## Related skills

- [../run-iteration-end-checklist/SKILL.md](../run-iteration-end-checklist/SKILL.md)
- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)
