---
title: "do-feature-iteration"
description: "Orchestration skill: drive one EARS-handler iteration end-to-end against an existing feature-spec. Replaces ADR-0007 §2.4 orchestrated iteration cycle as the procedural source of truth."
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
   5a. **UI pre-flight gate (if this handler touches any rendered surface).** If the iteration touches a user-facing UI surface (`apps/portal/**`, `apps/promo/**`, `apps/admin/**`, `packages/design-system/**`), then before the checklist + review you MUST:
   1. Run the **`build-ui-from-design-system` registry-research gate** ([../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md)) — adopt before bespoke, and record the adoption decision as a `registry-research:` line in the PR body (`adopted <block> from <registry>` or `bespoke — <why empty>`). Enforced by the `registry-research` CI gate (#251) + AGENTS.md §6.
   2. **Live-verify** in the actual running UI — drive **every field kind on every surface** in a browser (Playwright) on the dev-stand per [`.claude/rules/dev-stand.md`](../../../../../.claude/rules/dev-stand.md) and AGENTS.md §6, watching rendered error language + timing. **The interactive drive itself is NOT run inline by the lead** — dispatch it to a subagent (return = verdict + screenshot paths only) OR run a committed scripted Playwright spec that prints a compact pass/fail; the lead boots + holds the Stage-B stand but keeps MCP browser turns (snapshots / DOM / network dumps) out of its own context (#534, CLAUDE.md → Subagent context economy). Running the register→verify→landing drive inline was the single largest avoidable context burn of a one-file re-point session (2026-07-12). No user-facing dev placeholders (enforced by the `no-stub` CI gate, #251). Two rows this check keeps missing (owner Stage-B 2026-07-08, PRs #673/#674): **(a) click every CTA in every lifecycle state of the entity** (e.g. event upcoming/live/ended) — a CTA must never dead-end in a 404/no-op; a not-yet-built target is a graceful, tracked front door (its Issue named in the PR), never a broken link; **(b) drive the reject path of every field with garbage input** — a field whose value has no constraint in `packages/schemas` fails this check (tighten the SSOT schema first, then the form picks it up). The owner-facing Stage-B handoff follows the **mandatory handoff checklist** in [`build-ui-from-design-system` §Stage B](../build-ui-from-design-system/SKILL.md) (aux-service URLs from `.env.local`, "changed on purpose" list, variant questions).
   3. **Run the `playwright-axe` suite locally before opening the PR** — it is a BLOCK CI gate (AGENTS.md §5), and a breakpoints×themes live-verify does NOT cover contrast. Settled token fact it keeps re-catching: text on `bg-card` uses card-safe AA tokens (`text-primary-action`, blue.700 — the #270 precedent), never `text-primary` (blue.500, AA only on the pale `tint` surface). Precedent: PR #619's card kicker re-broke #270 and cost a full Mode-a rework round (#621).

   If this feature came through `do-product-discovery`, build the **approved mockup** referenced in `NNN-product.md` — the _screen-composition_ Stage A is pre-satisfied there (ADR-0014 §5); any element class not yet in the constitution still runs its own element-class Stage A. This gate is then composition + adoption + live-verify, not a fresh layout decision.

   This makes the §6 UI Hard rules _fire from the executing procedure_, not just sit in the constitution. Skip only for a genuinely backend-only handler (`surface: backend-only`).

6. **`run-iteration-end-checklist`** (dispatch) — verdict-gated. If `BLOCKED on #X`, fix item X and re-dispatch. Do **not** continue past a BLOCKED verdict.
7. **`surface-decision-debt`** (inline) — required invocation; output may be `[]` but the invocation itself is required.
8. `git push` + `gh pr create` with the PR template filled (kind label **and the `feature:NNN-<slug>` label**, `Closes #N`, `author:*`). Without the feature label, `pr:preflight`'s `spec-status-fresh` passes **vacuously** (no linked spec to check — the #606 hole; fail-loud guard tracked in #608); the label goes on at PR creation, not as a lead post-hoc fix.
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
- Direct `gh pr merge` without `--auto --squash --delete-branch` — process violation per ADR-0008 §2.6.

## Related skills

- [../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md)
- [../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md)
- [../verify-base-ci-green/SKILL.md](../verify-base-ci-green/SKILL.md)
- [../run-iteration-end-checklist/SKILL.md](../run-iteration-end-checklist/SKILL.md)
- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
- [../write-iteration-summary/SKILL.md](../write-iteration-summary/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)
