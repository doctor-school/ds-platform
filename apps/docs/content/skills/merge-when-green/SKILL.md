---
title: "merge-when-green"
description: "Procedural skill (inline): merge the PR via the single mandatory command, after positive review and green CI."
name: merge-when-green
mode: inline
---

# merge-when-green

**Kind:** procedural · **Mode:** inline.

## Input

- PR number `<N>`.
- Latest review verdict: `APPROVE` (from `request-mode-a-review` Mode (a), or a Mode (b) Codex review, or a Mode (c) human approval).
- Latest CI status: green.

## Procedure

Run exactly one command:

```bash
gh pr merge <N> --auto --squash --delete-branch
```

`--auto` instructs GitHub to hold the merge until all required checks pass — functionally equivalent to a required `ci` status check on the single-developer happy path (per ADR-0008 §2.6 + Amendment A3). `--squash` enforces linear history. `--delete-branch` cleans up the head branch.

Per ADR-0007 Amendment A2 (closing G11 finding F-10): a positive Mode (a) or Mode (b) verdict + green CI is sufficient to merge. **Human-merge is not required.** Mode (c) reviews remain a single human decision.

## Output

- PR merged into `main` (or queued for `--auto` merge once CI clears).
- Head branch deleted.

## Failure mode

- Any other merge command (`gh pr merge <N>` without `--auto`, with `--merge` instead of `--squash`, without `--delete-branch`, or `git push origin main` directly) is a process violation per ADR-0008 §2.6 + Amendment A3 interim contract.
- Invoking this skill while the latest review verdict is `REQUEST_CHANGES` or absent — process violation per `request-mode-a-review`'s `Cannot proceed without` clause.
