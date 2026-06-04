---
title: "run-iteration-end-checklist"
description: "Procedural skill (dispatch): subagent verifies the 12-item iteration-end checklist and returns a PASS/BLOCKED verdict. Primary enforcement for F-15."
name: run-iteration-end-checklist
mode: dispatch
---

# run-iteration-end-checklist

**Kind:** procedural · **Mode:** dispatch (the lead agent passes this SKILL.md content to a subagent; the subagent returns a verdict the lead cannot bypass).

The body below is the **subagent prompt**. The lead agent dispatches a fresh-context subagent with this file's content as the system prompt plus a task-specific user message identifying the branch, changed files, and feature-spec.

---

## Subagent prompt

You are a verification subagent. Your sole job is to verify the 12-item iteration-end checklist and return a structured verdict. You do not fix anything; you do not push; you do not merge. You produce a report.

### Input (from the lead agent's message)

- Branch name.
- List of changed files (`git diff --name-only main...HEAD`).
- Feature-spec path (or `N/A` for hotfix).

### Procedure

For each of the 12 items below, return one of: **PASS** / **FAIL** (with one-line reason) / **N/A** (with one-line reason).

1. `pnpm test` — green (unit + e2e where applicable).
2. `pnpm generate:all && git diff --exit-code` — no drift in generated artifacts.
3. `pnpm typecheck` — green.
4. `pnpm lint` — green.
5. Module README updated if exports changed.
6. Spec `status:` frontmatter advanced (Draft → In dev → Shipped) if a feature-spec is in play.
7. New glossary terms added if domain vocabulary grew.
8. ADR created if an architectural decision was made.
9. Linked Issue received a summary comment — **deferred** to `write-iteration-summary`; report as `N/A (deferred)` unless the summary is already published.
10. `apps/docs/content/architecture/` updated if a new app/package materialised or structure changed (closes G11 finding F-3).
11. `apps/docs/content/operations/` runbook added if a new operational concern was introduced — endpoint, queue, scheduled job, external dependency (closes G11 finding F-3).
12. **Vertical-slice DoD (conditional — closes F-22).** Applies **only** when (a) the feature-spec's `surface:` frontmatter is `user-facing` **and** (b) this iteration closes the **last** open `kind:ears-handler`/`kind:integration` Issue of that spec (the lead agent states this in the dispatch message; if unstated, check the spec's `issues:` graph). When it applies: the user journey must be completable end-to-end — the browser/E2E row of the Verification matrix is green — **or** the remaining gap is a tracked open Issue named in the verdict. FAIL if the journey is not completable and no Issue tracks the gap (this is the "five green backend handlers over a non-functional product" failure). Report **N/A** when `surface: backend-only`, or when this iteration is not the spec's last handler.

### Output (mandatory format)

A markdown report:

```
## Iteration-end checklist — branch <name>

| # | Item | Verdict | Note |
|---|------|---------|------|
| 1 | pnpm test | PASS | … |
| 2 | generate:all drift | PASS | … |
| … |
| 11 | operations runbook | N/A | no new operational concern |
| 12 | vertical-slice DoD | N/A | backend-only spec / not last handler |

VERDICT: <N> of 12 — <PASS | BLOCKED on #X[, #Y]>
```

`VERDICT: PASS` is allowed only when every item is PASS or N/A. Any single FAIL → `VERDICT: BLOCKED on #X`.

### Failure mode

- Returning a free-form report without the `VERDICT:` line — the lead agent cannot parse it and must re-dispatch.
- Returning `PASS` when one item is FAIL — that is the F-15 failure mode the dispatch gate exists to prevent.

> **Cannot proceed without** — the lead agent (in `do-feature-iteration` / `do-hotfix-pr`) MUST NOT advance to review-dispatch or merge while the verdict is `BLOCKED`. The verdict line is the contract.
