---
title: "do-product-discovery"
description: "Orchestration skill (inline): drive the discovery track of a product epic/feature end-to-end — legacy-mine the Bubble system, brainstorm the product, author the epic brief + feature PRD, co-evolve the Claude Design mockup to an owner-approved Stage-A pick, and hand off to spec-authoring. The upstream half of ADR-0014's dual-track lifecycle."
name: do-product-discovery
mode: inline
---

# do-product-discovery

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure itself; it invokes `superpowers:brainstorming`, dispatches `author-product-spec`, and runs `author-design-mockup`).

This is the **discovery-track** orchestrator for the task kind `product-discovery` (ADR-0014). It produces the product layer — a thin epic `brief.md` + a per-feature `NNN-product.md` PRD — plus an owner-approved design mockup, and hands the result to `spec-authoring` (`author-ears-spec`). It is the upstream complement of `do-feature-iteration` (delivery track). It does **not** re-own Issue creation / branch / review / merge — those belong to `run-task-lifecycle`, into whose **step 2** this skill slots exactly as `do-feature-iteration` does.

> **Cannot proceed to delivery without** — the discovery→delivery handoff gate (step 6): BOTH an owner-approved mockup (Stage A recorded) — or the backend-only skip — AND the PRD's product acceptance criteria. A feature crosses into `spec-authoring` / `feature-iteration` only when both exist (ADR-0014 §3, the dual-track contract).

## When this applies

A new product epic, or a user-facing feature with no PRD yet — the **Webinars** epic is the first. Not for: a backend-only feature with an existing spec (go straight to `author-ears-spec`), a bugfix (`do-hotfix-pr`), or an already-designed feature entering delivery (`do-feature-iteration`).

## Input

- A product epic/feature need (roadmap line, owner request). Epic → a Milestone; feature → a slug under `specs/features/`.
- The legacy reference: the Doctor.School Bubble app (`doctor-school-bubble-app`).

## Procedure

Execute in order. Each `→` is a hard gate: the next step does not begin until the prior step's output exists.

1. **`read-relevant-adrs`** (inline) — load ADR-0014 (this lifecycle), ADR-0013 (design SoT), ADR-0006 §4 (SDD triplet), plus any domain ADRs. Cite them in the first user-facing reply.
2. **Legacy-mine the Bubble system** (inline) — for the epic scope, extract the **domain model** (entities + attributes + inferred workflows) and screen flows from `doctor-school-bubble-app` (`data`, `directual`, screen exports). *Look-and-take-the-domain, never reproduce the UI, never copy the schema* — it is a functional reference; the data model is designed fresh (ADR-0014 §3). Output feeds the brief's "Prior art — source system" section.
3. **Brainstorm the product** — invoke `superpowers:brainstorming` (the sanctioned exception, AGENTS.md §3.4) to settle JTBD, the epic's information architecture, the feature decomposition, and the per-feature stories with the product owner. A genuine **product-scope** fork is the owner's (`AskUserQuestion`); sequencing / architecture forks are yours (memory `feedback_spec_work_brainstorm_reuse_delegate`). Do **not** chain into `writing-plans`.
4. **`author-product-spec`** (dispatch) — author the epic `brief.md` (thin: JTBD, IA, feature list, metrics, mined prior-art) and each feature `NNN-product.md` (stories with stable `US-N` ids, flows, draft acceptance criteria). Product-owner-facing artifacts carry an RU mirror. See ADR-0014 §1–2.
5. **`author-design-mockup`** (inline) — for each `user-facing` feature, compose the Claude Design **surface-layout** mockup from real components, co-evolving with the PRD's stories/draft-acceptance (loop back to step 4 when the design reveals a missing/wrong story). Any **uncovered element class** is delegated DOWN to the existing `research-ui-element` cycle (constitution → `@ds/design-system` + showcase), never invented. Get the owner's **screen-composition Stage-A** pick on the rendered mockup and record its reference in `NNN-product.md`. Skip entirely for a `surface: backend-only` feature.
6. **Discovery→delivery handoff** (gate) — a feature is delivery-ready only when BOTH the owner-approved mockup (or the backend-only skip) AND the PRD acceptance criteria exist. `brief.md` is revisable throughout (discovery is a **loop**, ADR-0014 §3); a changed decomposition re-flows into the affected feature-PRDs before this gate. Then hand off to **`spec-authoring`**: `author-ears-spec` reads `NNN-product.md` as its "PRD section"; `open-ears-issues` opens the EARS Issue set.

## Output

- `specs/product/<epic>/brief.md` (+ `-ru`) — thin epic PRD — committed.
- `specs/features/NNN-<slug>/NNN-product.md` (+ `-ru`) per feature, with stable `US-N` ids + the approved-mockup reference.
- New primitives (if any) merged into `@ds/design-system` + showcase as their own tracked iterations.
- Each `user-facing` feature carries a recorded Stage-A design sign-off.
- Handoff to `spec-authoring` per feature.

## Failure modes

- **Reproducing the Bubble UI / copying its schema** instead of mining the domain — the reference is functional, not a template (ADR-0014 §3).
- **Skipping the design co-evolution** and writing EARS from a text-only PRD for a `user-facing` feature — the mockup is the spec for delivery (the dual-track contract).
- **Crossing into delivery without both handoff artifacts** (mockup + acceptance) — the discovery gate exists to prevent it.
- **Re-implementing `run-task-lifecycle`'s Issue / branch / merge steps** — this skill is discovery-only; the lifecycle owns the outer loop.

## Related skills

- [../author-product-spec/SKILL.md](../author-product-spec/SKILL.md) · [../author-design-mockup/SKILL.md](../author-design-mockup/SKILL.md) — the two procedural halves.
- [../author-ears-spec/SKILL.md](../author-ears-spec/SKILL.md) · [../open-ears-issues/SKILL.md](../open-ears-issues/SKILL.md) — the downstream `spec-authoring` handoff.
- [../run-task-lifecycle/SKILL.md](../run-task-lifecycle/SKILL.md) — the outer loop this slots into (step 2).
- [../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md).
