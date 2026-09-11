---
title: "run-iteration-end-checklist"
description: "Procedural skill: verify applicable evidence against the 15-item iteration-end checklist and returns a PASS/BLOCKED verdict. Primary enforcement for F-15; item 12 enforces F-22; item 15 enforces approved-source parity evidence."
name: run-iteration-end-checklist
mode: inline
---

# run-iteration-end-checklist

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline by default; delegate when independent verification or context savings justify it. This is evidence accounting, not a second mandatory execution of the checks. Mode-a remains independent.

For delegation, use an independent fresh-context general agent with this skill path, branch, changed files, feature-spec and existing check evidence. Check the loaded role contract before dispatch: Codex's `ds-reviewer` profile is reserved for Mode (a) PR review and is not the checklist role. The checklist agent reads this skill as its task contract and returns its own report without fixing, pushing or merging.

---

## Subagent prompt

Your sole job is to verify the 15-item iteration-end checklist and return a structured verdict. You do not fix anything; you do not push; you do not merge. You produce a report.

### Input (from the lead agent's message)

- Branch name.
- List of changed files (`git diff --name-only main...HEAD`).
- Feature-spec path (or `N/A` for hotfix).

### Procedure

For each of the 15 items below, return one of: **PASS** / **FAIL** (with one-line reason) / **N/A** (with one-line reason).

1. Affected tests — green; include integration/e2e for changed boundaries or journeys. Reuse applicable results; broaden only for a named risk.
2. Generated artifacts — run affected generators and drift checks only if their inputs/contracts changed; otherwise N/A.
3. Affected typecheck — green when types/build behavior changed; otherwise N/A.
4. Required `pnpm lint` and applicable guards — green; use existing evidence, not a redundant rerun.
5. Module README updated if exports changed.
6. Spec `status:` frontmatter advanced (Draft → In dev → Shipped) if a feature-spec is in play.
7. New glossary terms added if domain vocabulary grew.
8. ADR created if an architectural decision was made.
9. Linked Issue received a summary comment — **deferred** to `write-iteration-summary`; report as `N/A (deferred)` unless the summary is already published.
10. `apps/docs/content/architecture/` updated if a new app/package materialised or structure changed (closes G11 finding F-3).
11. `apps/docs/content/operations/` runbook added if a new operational concern was introduced — endpoint, queue, scheduled job, external dependency (closes G11 finding F-3).
12. **Vertical-slice DoD (conditional — closes F-22).** Applies **only** when (a) the feature-spec's `surface:` frontmatter is `user-facing` **and** (b) this iteration closes the **last** open `kind:ears-handler`/`kind:integration` Issue of that spec (the lead agent states this in the dispatch message; if unstated, check the spec's `issues:` graph). When it applies: the user journey must be completable end-to-end — the browser/E2E row of the Verification matrix is green — **or** the remaining gap is a tracked open Issue named in the verdict. FAIL if the journey is not completable and no Issue tracks the gap (this is the "five green backend handlers over a non-functional product" failure). The Issue mandate here is an **instance of the AGENTS.md §6 significance threshold**, not a separate rule: an incomplete vertical slice blocks a product deliverable, so it sits above the threshold by definition — a `DEBT.md` ledger line is never a valid substitute for this gap. Report **N/A** when `surface: backend-only`, or when this iteration is not the spec's last handler.
13. **Field validation + input mask (conditional).** For every user-input field added or changed: a relevant client-side validation rule **and** input mask are declared (or `none` with a one-line reason), and a live browser check exercised one reject + one accept per field. Prefer the shared field primitives (#197) over raw inputs. FAIL if a touched field ships with no declared rule/mask and no `none`-with-reason, or with no live reject/accept check. Report **N/A** when the iteration touches no user-input field.
14. **Registry-research marker (conditional).** When the diff adds any **bespoke** UI element under a UI surface (`apps/portal/`, `apps/promo/`, `apps/admin/`, `packages/design-system/`), the PR body carries the `registry-research:` artifact (`adopted <block> from <registry>` or `bespoke — <which registries searched, why no fit>`) — written **before** the PR is opened, not reactively after the `registry-research` CI gate goes red. FAIL if a bespoke UI element ships with no marker. Report **N/A** when the diff touches no UI source, or adds no bespoke element (pure refactor/adoption of an existing owned primitive). Format is lint-enforced by `tools/lint/registry-research-lint.ts`; memory `feedback_registry_research_before_bespoke_ui`.

15. **Canvas-parity evidence (conditional).** Apply the following contract to every non-exempt UI-source change; otherwise report N/A.

### Canvas-parity evidence contract (BLOCK)

For item 15 read [the full shared parity evidence contract](../build-ui-from-design-system/parity-evidence.md). Verify every required source/profile/render/interaction field and reviewer binding; no render delta uses only its reviewer-certified N/A route.

### Output (mandatory format)

A markdown report:

```
## Iteration-end checklist — branch <name>

| # | Item | Verdict | Note |
|---|------|---------|------|
| 1 | affected tests | PASS | evidence + scope |
| 2 | generate:all drift | PASS | … |
| … |
| 11 | operations runbook | N/A | no new operational concern |
| 12 | vertical-slice DoD | N/A | backend-only spec / not last handler |
| 13 | field validation + mask | N/A | no user-input field touched |
| 14 | registry-research marker | N/A | no bespoke UI element added |
| 15 | approved-source parity evidence | N/A | no UI source changed |

VERDICT: <N> of 15 — <PASS | BLOCKED on #X[, #Y]>
```

`VERDICT: PASS` is allowed only when every item is PASS or N/A. Any single FAIL → `VERDICT: BLOCKED on #X`.

### Failure mode

- Returning a free-form report without the `VERDICT:` line — the lead agent cannot parse it and must re-dispatch.
- Returning `PASS` when one item is FAIL — that is the F-15 failure mode the dispatch gate exists to prevent.

> **Cannot proceed without** — the lead agent (in `do-feature-iteration` / `do-hotfix-pr`) MUST NOT advance to review-dispatch or merge while the verdict is `BLOCKED`. The verdict line is the contract.
