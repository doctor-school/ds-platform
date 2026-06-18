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
3. **UI pre-flight gate (if the fix touches any rendered surface).** If the change touches a user-facing UI surface (`apps/portal/**`, `apps/promo/**`, `apps/admin/**`, `packages/design-system/**`) — even a "one-line" tweak like a radius, color, label, or copy string — you MUST, before the review step:
   1. Run the **`build-ui-from-design-system` registry-research gate** ([../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md)) — inventory `@ds/design-system`, search the approved toolbox (shadcn · Origin UI · Intent·Jolly · Kibo), and **record the adoption decision** (`adopted <block> from <registry>` or `bespoke — <why the search came up empty>`) as a `registry-research:` line in the PR body. This is enforced by the `registry-research` CI gate (#251) and by AGENTS.md §6.
   2. **Live-verify** the fix in the actual running UI — bring up the dev-stand and drive the journey in a browser (Playwright) per [`.claude/rules/dev-stand.md`](../../../../../.claude/rules/dev-stand.md) and AGENTS.md §6 ("Verify UI live before done"). `run-iteration-end-checklist` + Mode-a are necessary but **not** sufficient — they never prove the rendered result.
   3. Do **not** ship a user-facing dev placeholder (e.g. a "set this env var" note) — render the real thing or nothing. Enforced by the `no-stub` CI gate (#251).

   These steps are the §6 Hard rules _invoked at the point of UI work_, not merely co-resident in the constitution. Skip this gate only when the diff touches no rendered surface (pure backend / CI / tooling fix).

4. **`run-iteration-end-checklist`** (dispatch) — verdict-gated. Items that are N/A for a hotfix (spec status frontmatter, glossary, ADR, architecture/operations docs) are returned as `N/A` by the subagent, not silently skipped.
5. **`surface-decision-debt`** (inline) — required invocation.
6. `git push` + `gh pr create` (label `bug`, `Closes #N`, `author:*`; include the `registry-research:` line from step 3 if it applied).
7. **`request-mode-a-review`** (dispatch) — verdict-gated.
8. **`respond-to-review`** (inline) — loop until APPROVE + green CI.
9. **`write-iteration-summary`** (inline).
10. **`merge-when-green`** (inline).

Skipped vs `do-feature-iteration`:

- `read-relevant-adrs` is **not** invoked by default. If the bug touches an architectural boundary (e.g., the fix changes an HTTP contract or a DB constraint), explicitly invoke it and cite the relevant ADR section in the PR description.
- `author-ears-spec` and `open-ears-issues` are not part of this flow.

## Output

- PR merged, Issue `#N` closed, iteration summary published.

## Failure mode

- Fixing the symptom without a failing test that demonstrates the bug — TDD violation, hotfix without reproducer.
- Skipping a discipline gate — same as `do-feature-iteration`.
- **Shipping a UI fix without the pre-flight gate (step 3)** — tokenizing a value but never running registry-research or live-verify. This is the exact gap #251 closes: a "one-line" radius fix is still a UI change.

## Related skills

- [../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md)
- [../run-iteration-end-checklist/SKILL.md](../run-iteration-end-checklist/SKILL.md)
- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)
