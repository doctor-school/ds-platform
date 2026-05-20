---
title: "write-iteration-summary"
description: "Procedural skill (inline): publish an Issue comment summarising file paths touched, decisions taken, decision-debt items, links."
name: write-iteration-summary
mode: inline
---

# write-iteration-summary

**Kind:** procedural · **Mode:** inline.

## Input

- Branch name.
- Feature-spec path (or `N/A` for hotfix / ADR amendment).
- Issue number `#N`.
- List of changes from `git diff --name-only main...HEAD`.
- Outputs of `surface-decision-debt` (debt-item list, may be `[]`).

## Procedure

Publish an Issue comment via `gh issue comment <N> --body-file <file>`. The body uses this template:

```markdown
## Iteration summary — PR #<PR-N>

**Branch:** <branch-name>
**Spec:** <feature-spec path or N/A>

### Files touched

- <path/to/file-1>
- <path/to/file-2>
- …

### Decisions

- <decision-1 with one-line rationale>
- …

### Decision-debt opened

- #<followup-N1> — <one-line description>
- #<followup-N2> — <one-line description>

(or: "no decision-debt items")

### Links

- ADR amendments: <list or "none">
- Follow-up Issues: <list or "none">
- Iteration spec status: <Draft → In dev | In dev → Shipped | unchanged>
```

Record the resulting comment URL in the PR description so the merge-time reviewer (or auditor) can find it without hunting.

## Output

- Issue comment published.
- Comment URL recorded in PR description.

## Failure mode

- Skipping the summary at the moment of merge — the F-15 / F-20 pattern. The Issue closes with no human-readable trace of what was decided.
