---
title: "author-feature-spec"
description: "Orchestration skill (inline): drive the spec-authoring stage end-to-end — review the current (legacy) system, load ADRs, brainstorm the product scope, then dispatch the SDD triplet and open its Issue set. Makes spec-authoring a project-catalog skill (the path is the contract) instead of a bare vendor-skill mapping."
name: author-feature-spec
mode: inline
---

# author-feature-spec

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure itself; it invokes `superpowers:brainstorming` as the step-2 vehicle in Claude Code, and dispatches `author-ears-spec` at step 3).

This is the **spec-authoring** orchestrator for the task kind `spec-authoring` (AGENTS.md §3.1). It exists so the stage is dispatched **by catalog path**, not by a bare `superpowers:brainstorming` mapping — vendor-agnosticism (AGENTS.md §3.3, "the path is the contract") and the CURRENT-system review that must precede any replacement design were previously codified nowhere. It is connective: it names the canonical sequence and invokes the existing catalog skills at each gate rather than restating them. It slots into `run-task-lifecycle` step 2 exactly as `do-feature-iteration` / `do-product-discovery` do.

> **Cannot proceed without** — the ADRs loaded by `read-relevant-adrs` (step 1) **before** any open-ended brainstorm (F-16), and the current-behaviour → replacement-delta summary of step 0 as a brainstorm input. The lead does not open the brainstorm without both in hand.

## When this applies

Authoring a new feature-spec (the SDD triplet) — the `spec-authoring` kind. A **user-facing product feature with no PRD** enters upstream at `product-discovery` (`do-product-discovery`), which hands off _into_ this skill once the brief + PRD + approved mockup exist (ADR-0014). A pure ADR / design-spec authoring task uses `superpowers:brainstorming` under §3.4 directly — this skill is for the feature-spec triplet.

## Input

- A feature need: a `NNN-product.md` PRD (when the feature came through `do-product-discovery`), or a roadmap line / initiative description for a backend-only or legacy spec with no PRD.
- The feature number `NNN` (next free under `apps/docs/content/specs/features/`) and slug.
- The legacy reference: the current production Doctor.School system (sibling repo `sidorovanthon/bbm` where the feature area lives there; product-owner Q&A otherwise).

## Procedure

Execute in order. Each `→` is a hard gate: the next step does not begin until the prior step's output exists.

0. **Current-system review** (inline) — study how the **current production Doctor.School system** behaves in this feature area (the legacy sibling repo `sidorovanthon/bbm` as reference where relevant; product-owner Q&A otherwise) and write a short **"current behaviour → replacement delta"** summary. This summary is a **mandatory brainstorm input** (step 2) — the replacement is designed against what exists today, not in a vacuum. Skip **only** for a feature with no legacy counterpart, and then only with an **explicit note** recording that there is nothing to review. If the feature came through `do-product-discovery`, its brief already carries the mined "Prior art — source system" section (ADR-0014 §3) — reference that here instead of re-mining.
1. **`read-relevant-adrs`** ([../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md), inline) — load the ADRs governing the feature's domain **before** any open-ended exploration. Cite the loaded sections in the first user-facing reply (`per ADR-NNNN §X.Y …`). Brainstorming without ADRs loaded is the F-16 violation.
2. **Brainstorm the product scope** — settle the product-scope forks **one question at a time with the product owner**; **technical / architecture / sequencing calls the lead settles itself** by best-architecture (memory `feedback_spec_work_brainstorm_reuse_delegate`), reserving `AskUserQuestion` for a genuine product-scope fork or a true blocker. In **Claude Code** the implementation vehicle is **`superpowers:brainstorming`** — the sole allowed `superpowers:*` exception (AGENTS.md §3.4); on other harnesses follow this step's inline description directly. The step-0 delta summary and the step-1 ADRs are the required inputs. **Do NOT chain into `superpowers:writing-plans`** — the SDD triplet **is** the plan (ADR-0007 §2.4). If the feature is `user-facing`, note that the **Stage-A design gate** (`build-ui-from-design-system`) will gate implementation and the WBS must name the UI deliverable in the same slice as its backend (F-22, AGENTS.md §6) — it is named here, not re-derived.
3. **`author-ears-spec`** ([../author-ears-spec/SKILL.md](../author-ears-spec/SKILL.md), **dispatch**) — the subagent authors the 3-file triplet (`NNN-requirements.md` + `NNN-design.md` + `NNN-scenarios.feature`) with the `surface:` classification and the F-22 guards. The lead does **not** author the triplet inline.
4. **`open-ears-issues` + spec-PR sequencing** — run [`open-ears-issues`](../open-ears-issues/SKILL.md) to open the parent + per-EARS child Issues with the native sub-issue / blocked-by graph, and follow the single-docs-PR sequencing already defined in `author-ears-spec` **step 7** (triplet + `issues:` frontmatter write-back ship in one docs-PR, merging on a Mode (a) verdict + green CI; per-iteration code PRs begin only after the spec is on `main`). Do **not** restate their procedures — this skill is connective.

## Output

- The SDD triplet committed under `apps/docs/content/specs/features/NNN-<slug>/` with `surface:` set.
- The parent + child Issues opened with native links, their numbers written back into the `issues:` frontmatter, shipped in one docs-PR.
- The current-behaviour → replacement-delta summary recorded (or the explicit no-legacy-counterpart note).
- Handoff to `feature-iteration` (`do-feature-iteration`) once the spec is on `main`.

## Failure modes

- **Skipping step 0 silently** — designing the replacement without reviewing the current system, and without the explicit no-legacy-counterpart note. The delta summary is a required brainstorm input.
- **Brainstorming without ADRs loaded** (F-16) — running `superpowers:brainstorming` before `read-relevant-adrs`, re-deriving an answer already fixed in an ADR.
- **Chaining into `superpowers:writing-plans`** after the brainstorm — the triplet is the plan; the chain is disallowed (AGENTS.md §3.4).
- **Authoring the triplet inline** instead of dispatching `author-ears-spec` — the triplet is a dispatch artifact, not lead-authored prose.

## Related skills

- [../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md) — ADRs before brainstorm (step 1).
- [../author-ears-spec/SKILL.md](../author-ears-spec/SKILL.md) — the triplet dispatch + spec-PR sequencing (steps 3–4).
- [../open-ears-issues/SKILL.md](../open-ears-issues/SKILL.md) — the EARS Issue set with the native graph (step 4).
- [../do-product-discovery/SKILL.md](../do-product-discovery/SKILL.md) — the upstream discovery track that hands off into this skill (ADR-0014).
- [../do-feature-iteration/SKILL.md](../do-feature-iteration/SKILL.md) — the downstream delivery track, once the spec is on `main`.
- [../run-task-lifecycle/SKILL.md](../run-task-lifecycle/SKILL.md) — the outer loop this slots into (step 2).
