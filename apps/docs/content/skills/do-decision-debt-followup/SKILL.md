---
title: "do-decision-debt-followup"
description: "Orchestration skill: close a silent-decision artifact surfaced in a prior iteration. Routes to the appropriate downstream skill."
name: do-decision-debt-followup
mode: inline
---

# do-decision-debt-followup

**Kind:** orchestration · **Mode:** inline.

> **Cannot proceed without** — a closing artifact linked from the debt item. "Drop with no rationale" is not a valid resolution. If the debt is genuinely no-longer-relevant, close with a comment explaining why (the closing comment is itself the closing artifact).

## Input

- Debt-item reference: GitHub Issue with `decision-debt` label, or an iteration-summary line, or a PR comment.

## Procedure

1. **Read the debt item** and classify its nature:
   - **ADR-revision** — silent deviation from an existing ADR → route to `do-adr-revision`.
   - **New ADR** — decision is large enough to warrant its own immutable record → route to `superpowers:brainstorming` (sole allowed exception per AGENTS.md §3.4) for the spec, then to `do-adr-revision` for the implementation if it revises an existing ADR, or to a fresh ADR-NNNN authoring task.
   - **Feature-spec correction** — a `NNN-requirements.md` / `NNN-design.md` is incomplete or wrong → inline correction PR (no orchestration skill needed for small corrections; treat as a doc PR similar to `do-hotfix-pr` without the test).
   - **Drop with rationale** — debt is no longer relevant. Close the Issue with a comment that states why.
2. **Execute the routed flow.**
3. **Close the debt item** by linking the closing artifact (PR URL, new ADR, comment).

## Output

- Debt item closed.
- Closing artifact linked in the debt item's closing comment.

## Failure mode

- Closing without a linked artifact or rationale — the F-21 anti-pattern. Decision-debt that is silently closed without trace defeats the surfacing discipline.

## Related skills

- [../do-adr-revision/SKILL.md](../do-adr-revision/SKILL.md)
- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
