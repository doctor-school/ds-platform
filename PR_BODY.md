## What

A new PR-event lint guard, `spec-deletion` (`tools/lint/spec-deletion-lint.ts`),
that inspects the PR diff and flags a PR which **deletes** a feature-spec or ADR
file. Specs and ADRs are retired by a `status: Superseded` / `Retired`
frontmatter transition, never by file removal (AGENTS.md §6 "Amendment vs inline
rewrite" / ADR-0006 §7).

Root cause it guards against (#971): a complete two-tier spec layer (10 files)
was silently `git rm`'d inside an unrelated feature PR, with no guard to catch it.

## Rule

Fires (WARN) when a PR deletes (`git diff --name-status` status `D`) any
`*.md` / `*.feature` under `apps/docs/content/specs/**` or
`apps/docs/content/adr/**` — UNLESS a sanctioned escape holds:

- **Superseded transition** — the PR also carries a `status: Superseded` /
  `status: Retired` frontmatter on a modified spec/ADR file (a documented
  retirement wave); OR
- **Body marker** — the PR body carries `spec-deletion: <reason + superseding ref>`; OR
- **Pure rename** — `git --find-renames` detects `R`; a move is not a deletion
  and never trips the guard.

## Design

- **Pure seam.** `evaluateSpecDeletion(entries, supersededPaths, prBody)` is a
  pure verdict function (unit-tested directly). A thin wrapper computes the three
  inputs from `git diff --name-status --find-renames origin/main...HEAD`, tree
  reads for the Superseded frontmatter, and `gh pr view body`.
- Modelled on the sibling `spec-link` / `prior-decisions` / `tdd-signal` family
  (`lib/gh` seam, exit-code convention, PR-event gating).
- **Severity: WARN** (ADR-0007 §2.6 new-guard posture) — the guard exits non-zero
  on a finding; its CI job `spec-deletion` carries `continue-on-error: true`. To
  promote to BLOCK, drop that one line (single clearly-marked constant + CI flag).

## Wiring

Added the `spec-deletion` job to `.github/workflows/pr-body-guards.yml` (the same
PR-event family as `spec-link`). Diff-based, so it checks out full history
(`fetch-depth: 0`) and re-runs on a body `edited` event so a newly-added
`spec-deletion:` marker re-clears the check. Registered `pnpm lint:spec-deletion`.

## Tests

`tools/lint/guard-tests/spec-deletion-lint.spec.ts` — 17 tests (all green):

- Pure unit tests over `evaluateSpecDeletion` + helpers (deletion vs rename, both
  escapes, non-retireable paths, empty-marker rejection).
- Exit-code harness (`@ds/lint-guard-tests`) with fixtures: green-rename,
  red-bare-deletion, green-marker, green-superseded, non-PR skip.

Full guard-tests suite: 919/919 pass. `pnpm pr:preflight --static`: 25/25 pass.
`workflow-auth` guard confirms the new CI job carries the required auth block.

Closes #971

kind: tooling
registry-research: n/a (no UI surface)
Product note: n/a (internal tooling / CI guard)
author:claude
