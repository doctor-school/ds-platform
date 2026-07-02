---
title: "do-adr-revision"
description: "Orchestration skill: revise an existing ADR or paired design spec (EN+RU parity mandatory). Inline rewrite by default; amendment block ONLY for running-production decisions."
name: do-adr-revision
mode: inline
---

# do-adr-revision

**Kind:** orchestration · **Mode:** inline.

> **Cannot proceed without** — EN+RU parity for every edited section, **and** parallel edits to the paired design-spec (`-design-en.md` / `-design-ru.md`) if one exists. A PR that lands the EN edit without the RU mirror fails review on principle. The reviewer is instructed to REQUEST_CHANGES on language drift regardless of other findings.

## When to use this skill

You are revising an existing ADR (or its paired design spec) — closing an open question, replacing a deferred decision with a concrete one, updating in light of new information, removing a now-dead reference, etc.

Per **AGENTS.md §6** (Amendment vs inline rewrite discipline), in pre-pilot (paper-architecture, no production code), there are **NO amendment blocks** in ADR / spec / design docs. Every revision is an **inline rewrite**: the body reads as if the current decision were always the decision. The history of paper-architecture evolution lives in `git log`, not in the document body.

An amendment block is justified **only** when the original decision is **running in production** and was reversed / refined post-launch. In Phase 0 / pre-pilot this does not apply — default to inline rewrite.

## Input

- ADR number (e.g., `0007`).
- Reason for revision: G11 finding ID, GitHub Issue link, Plane reference, or discussion link.
- Mode: **inline rewrite** (default) or **amendment block** (only with explicit running-production justification documented in the PR description).

## Procedure (inline rewrite — the default path)

1. **Read all four files** (RU + EN narrative + RU + EN design, where applicable). Identify every section the revision touches.
2. **Rewrite in EN narrative** — edit the affected sections in place so the document reads as if the current decision were always the decision. Delete or rewrite any prose that referenced the old decision (do not leave "previously …" / "before X we did Y" / "SUPERSEDED by …" callouts in the body — those belong in `git log`, not the document).
3. **Mirror to RU narrative** — semantically equivalent, not a literal calque. Use the technical terminology already established in the file.
4. **If a paired design-spec exists, mirror the revision there** (EN + RU). The same inline-rewrite rule applies.
5. **Sweep cross-references — BOTH directions.** (a) _Outbound:_ grep the rest of the repo for citations of the changed text (`grep -r "<old-rule-fragment>" apps/docs/content/` and around `AGENTS.md`, `CLAUDE.md`, skills, CI workflows, lint TS files); update each citation to point at the new rule formulation, or delete/rewrite prose that referenced deleted content. (b) _Inbound:_ grep for every doc that points AT the rewritten file/section — sibling skills' self-descriptions and Related lines, ADR §-references, path promises (SSOT tables, generator sketches, CI-freshness lists) — and reconcile them in the **same commit**; an outbound-only sweep misses these (the PR #466/#469 review NITs). When the revision is dispatched to a subagent, the brief MUST echo step (b) explicitly.
6. `git push` + `gh pr create` (label `docs`, `Closes #N` if there is a tracking Issue).
7. **`request-mode-a-review`** (dispatch) — reviewer is instructed to verify EN+RU parity explicitly and flag any "previously / now / SUPERSEDED" callouts left in the body.
8. **`respond-to-review`** (inline) — loop until APPROVE.
9. **`merge-when-green`** (inline).

## Procedure (amendment block — only for running-production decisions)

Only when AGENTS.md §6 is satisfied (the decision being changed is running in production). Otherwise default to inline rewrite.

1. Read all four files as in step 1 above.
2. Draft the amendment block in EN narrative following the format already established in the ADR (Context / Decision / Consequences / Why now / Open follow-up / Affects). Use the next free letter (`A2` after `A1`, etc.); do not consolidate or renumber existing amendments.
3. Mirror to RU narrative; mirror to paired design spec if it exists (design-spec amendments use a parallel `SD<N>` prefix (so design-level revisions are distinguished from ADR-level `A<N>` revisions)).
4. Continue with steps 5–9 from the inline-rewrite procedure above.

## Output

- ADR `0NNN-<slug>-{en,ru}.md` revised (inline) or amended (next free letter).
- Paired design-spec `0NNN-<slug>-design-{en,ru}.md` revised / amended if it exists.
- Cross-refs across the repo updated to the new rule formulation.
- PR merged.

## Failure mode

- Landing the EN revision without the RU mirror — drift accumulates and the next AI session reads contradictory specs. Reviewer-agent must REQUEST_CHANGES.
- Skipping the paired design-spec when one exists — drift between ADR and its design rationale.
- Leaving "previously / before X we did Y / SUPERSEDED by …" callouts in the body during an inline rewrite — violates AGENTS.md §6. Body reads as current state; history lives in `git log`.
- Writing a fresh amendment block in pre-pilot when no running-production decision is involved — violates AGENTS.md §6. Default to inline rewrite.

## Related skills

- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)
