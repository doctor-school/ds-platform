---
title: "respond-to-review"
description: "Procedural skill (inline): for each review finding, either fix or reject-with-rationale on the review thread. Loop until APPROVE."
name: respond-to-review
mode: inline
---

# respond-to-review

**Kind:** procedural · **Mode:** inline.

## Input

- Review report from `request-mode-a-review` (with `VERDICT: REQUEST_CHANGES` and a list of `[BLOCKER] / [NIT] / [SUGGESTION]` findings).

## Procedure

1. **For each finding**, decide one of:
   - **Fix** — implement the change. Commit with a message that cites the finding and, if the reviewer offered multiple options, the chosen option plus a one-line rationale (closes G11 finding F-24).
   - **Reject with rationale** — reply on the review thread explaining why the finding is wrong / out-of-scope / a false positive. Silent rejection is forbidden.
2. **Order of attention:** all `[BLOCKER]` findings before any `[NIT]` / `[SUGGESTION]`. `[BLOCKER]` findings must be either fixed or explicitly rejected with rationale; `[NIT]` and `[SUGGESTION]` may be deferred to a follow-up Issue with a link.
3. **Re-dispatch `request-mode-a-review`** once all `[BLOCKER]` findings are addressed.
4. **Loop** until the verdict is `APPROVE` and CI is green.

## Output

- Fix commit(s) on the PR branch.
- Reply thread on each review comment (resolved or rejected-with-rationale).

## Failure mode

- Silent rejection of a finding without rationale on the review thread — the reviewer sees the finding marked resolved without explanation, which defeats the audit trail.
- Choosing one of several reviewer-offered fix options without citing the choice in the commit message — F-24 pattern.

## Related skills

- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
