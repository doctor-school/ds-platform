---
title: "do-feature-iteration"
description: "Orchestration skill: drive one EARS-handler iteration end-to-end against an existing feature-spec. Replaces ADR-0007 §2.4 8-step cycle as the procedural source of truth."
name: do-feature-iteration
mode: inline
---

# do-feature-iteration

**Kind:** orchestration · **Mode:** inline (the lead agent executes this procedure itself; it dispatches subagents only at the sub-steps explicitly marked dispatch).

> **Cannot proceed without** — the artifacts produced by `run-iteration-end-checklist` (PASS verdict), `request-mode-a-review` (APPROVE verdict), and `surface-decision-debt` (list, may be `[]`). The lead agent does not advance past these gates without the artifact in hand. ADR-0007 §2.4 codifies this as the verdict-gated iteration cycle (G11 findings F-14 review-forgotten and F-15 decorative-checklist).

## Input

- GitHub Issue `#N` with `feature:NNN-<slug>` label and `kind:ears-handler` label.
- Feature-spec path `apps/docs/content/specs/features/NNN-<slug>/`.
- Branch name `feat/<N>-<slug>` (or resumable branch already in flight).

## Procedure

Execute the steps in order. Each `→` is a hard gate: the next step does not begin until the prior step's output exists.

1. **`read-relevant-adrs`** (inline) — load ADRs cited in `NNN-requirements.md` "Prior decisions" plus any architecturally adjacent ADRs. Cite them in the first user-facing reply.
2. **`verify-base-ci-green`** (inline) — `gh run list --branch main --limit 1`. If red, note in PR description that baseline was already red.
3. **RED** — write one failing Vitest test per EARS-N. Naming: `it('EARS-N: when <trigger>, system shall <behavior>')`. Flat numbering per ADR-0006 §4; nest to `N.M` only when one handler carries multiple shall-clauses.
4. **GREEN** — minimum code to pass the failing test.
5. **REFACTOR** — clean up while staying green.
6. **`run-iteration-end-checklist`** (dispatch) — verdict-gated. If `BLOCKED on #X`, fix item X and re-dispatch. Do **not** continue past a BLOCKED verdict.
7. **`surface-decision-debt`** (inline) — required invocation; output may be `[]` but the invocation itself is required.
8. `git push` + `gh pr create` with the PR template filled (label, `Closes #N`, `author:*`).
9. **`request-mode-a-review`** (dispatch) — verdict-gated. If `REQUEST_CHANGES`, route to `respond-to-review`. Re-dispatch until APPROVE.
10. **`respond-to-review`** (inline) — fix or reject-with-rationale per finding. Loop with step 9 until APPROVE + green CI.
11. **`write-iteration-summary`** (inline) — Issue comment with file paths, decisions taken, decision-debt items, links.
12. **`merge-when-green`** (inline) — `gh pr merge <N> --auto --squash --delete-branch`. Per ADR-0007 §2.4 + §2.10, a positive Mode (a) verdict + green CI is sufficient; human-merge is not required.

## Output

- PR merged into `main`, branch deleted.
- Issue `#N` closed (auto-close via `Closes #N`).
- Iteration summary comment URL recorded in the PR description.
- Any decision-debt items opened as follow-up Issues with `decision-debt` label.

## Failure mode

- Skipping any of the three discipline gates (`run-iteration-end-checklist`, `request-mode-a-review`, `surface-decision-debt`) — process violation. This is the F-14 / F-15 / F-19 / F-21 pattern documented in G11 findings; the gate-artifact contract exists specifically to prevent silent skip.
- Direct `gh pr merge` without `--auto --squash --delete-branch` — process violation per ADR-0008 §2.6 + A3.

## Related skills

- [../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md)
- [../verify-base-ci-green/SKILL.md](../verify-base-ci-green/SKILL.md)
- [../run-iteration-end-checklist/SKILL.md](../run-iteration-end-checklist/SKILL.md)
- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
- [../write-iteration-summary/SKILL.md](../write-iteration-summary/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)
