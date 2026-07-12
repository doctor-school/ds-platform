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

> **⛔ Scope ceiling — remediation is NOT a greenfield epic.** When the trigger is fixing/retiring an **existing** surface (a stub on prod, a rejected page, a bug on a shipped route), this skill is scope-**anchored** to that surface and its **already-shipped** destinations. Before brainstorming anything, enumerate the real pages (`find apps/*/app -name page.tsx`): if the destination already ships, the answer is a **minimal re-point / render-swap**, and discovery produces a 1-line PRD increment — not an epic, not a new shell/nav/component. A rebuild or ANY net-new surface/nav/feature requires an **explicit owner opt-in in their own words**; discovery must never introduce one on its own initiative. Routing a remediation through SDD (correct — a user-facing surface needs a PRD, #778) does NOT license inflating its scope. This is the ceiling with no counterpart in #778. Memory: [[feedback_remediation_scope_anchor]]. Precedent: #729 stub-fix (#769/#770 re-point) was inflated into the «Portal surface IA» epic with the invented «Школы» nav — cancelled 2026-07-12.

## Input

- A product epic/feature need (roadmap line, owner request). Epic → a Milestone; feature → a slug under `specs/features/`.
- The legacy reference: the Doctor.School Bubble app (`doctor-school-bubble-app`).

## Procedure

Execute in order. Each `→` is a hard gate: the next step does not begin until the prior step's output exists.

1. **`read-relevant-adrs`** (inline) — load ADR-0014 (this lifecycle), ADR-0013 (design SoT), ADR-0006 §4 (SDD triplet), plus any domain ADRs. Cite them in the first user-facing reply.
2. **Legacy-mine the Bubble system** (inline) — for the epic scope, extract the **domain model** (entities + attributes + inferred workflows) and screen flows from `doctor-school-bubble-app` (`data`, `directual`, screen exports). _Look-and-take-the-domain, never reproduce the UI, never copy the schema_ — it is a functional reference; the data model is designed fresh (ADR-0014 §3). Output feeds the brief's "Prior art — source system" section. **Split-discovery artifact:** when discovery spans sessions (the mining lands before the brief exists), commit the mining output as `specs/product/<epic>/legacy-recon.md` (+ RU mirror `legacy-recon-ru.md` — it is owner-facing brainstorm pre-read) via the normal docs-PR path; the brief's Prior-art section then **references and condenses** it, never duplicates it.
3. **Brainstorm the product** — invoke `superpowers:brainstorming` (the sanctioned exception, AGENTS.md §3.4) to settle JTBD, the epic's information architecture, the feature decomposition, and the per-feature stories with the product owner. A genuine **product-scope** fork is the owner's (`AskUserQuestion`); sequencing / architecture forks are yours (memory `feedback_spec_work_brainstorm_reuse_delegate`). Do **not** chain into `writing-plans`. **Provenance discipline:** only forks the owner actually picked are «owner-approved»; connective content YOU generated (a nav item, an IA element, a surface) is **`agent-proposed — UNCONFIRMED`** and stays gated until the owner confirms it in their own words — never laundered into a «settled decisions» block ([[feedback_owner_approved_provenance]]). A brainstorm whose «approved» output the owner does not recognise is the failure this guards.
4. **`author-product-spec`** (dispatch) — author the epic `brief.md` (thin: JTBD, IA, feature list, metrics, mined prior-art) and each feature `NNN-product.md` (stories with stable `US-N` ids, flows, draft acceptance criteria). Product-owner-facing artifacts carry an RU mirror. See ADR-0014 §1–2. **The product-layer docs-PR is a spec artifact: Mode-a APPROVE + green CI before merge — the "pure docs" fast path does not apply** (`request-mode-a-review` §Scope, precedent #480).
5. **`author-design-mockup`** (inline) — for each `user-facing` feature, compose the Claude Design **surface-layout** mockup from real components, co-evolving with the PRD's stories/draft-acceptance (loop back to step 4 when the design reveals a missing/wrong story). Any **uncovered element class** is delegated DOWN to the existing `research-ui-element` cycle (constitution → `@ds/design-system` + showcase), never invented. Get the owner's **screen-composition Stage-A** pick on the rendered mockup and record its reference in `NNN-product.md`. Skip entirely for a `surface: backend-only` feature.
6. **Discovery→delivery handoff** (gate) — a feature is delivery-ready only when BOTH the owner-approved mockup (or the backend-only skip) AND the PRD acceptance criteria exist. `brief.md` is revisable throughout (discovery is a **loop**, ADR-0014 §3); a changed decomposition re-flows into the affected feature-PRDs before this gate. Then hand off to **`spec-authoring`**: `author-ears-spec` reads `NNN-product.md` as its "PRD section"; `open-ears-issues` opens the EARS Issue set.

## Output

- `specs/product/<epic>/brief.md` (+ `-ru`) — thin epic PRD — committed.
- `specs/product/<epic>/legacy-recon.md` (+ `-ru`) — the step-2 mining artifact, committed only for a split-across-sessions discovery; the brief references/condenses it.
- `specs/features/NNN-<slug>/NNN-product.md` (+ `-ru`) per feature, with stable `US-N` ids + the approved-mockup reference.
- New primitives (if any) merged into `@ds/design-system` + showcase as their own tracked iterations.
- Each `user-facing` feature carries a recorded Stage-A design sign-off.
- Handoff to `spec-authoring` per feature.

## Failure modes

- **Inflating a remediation into a greenfield epic** — running full discovery on a stub-fix / rejected-page and emitting a new shell, nav, or surface (the «Школы» precedent). The scope ceiling above exists to prevent it: anchor to the existing surface, prefer a re-point, and never introduce a net-new surface without explicit owner opt-in.
- **Laundering agent-invented elements as «owner-approved»** — writing a «settled decisions» block containing IA/nav/surfaces the owner never named. Per-element provenance only ([[feedback_owner_approved_provenance]]).
- **Reproducing the Bubble UI / copying its schema** instead of mining the domain — the reference is functional, not a template (ADR-0014 §3).
- **Skipping the design co-evolution** and writing EARS from a text-only PRD for a `user-facing` feature — the mockup is the spec for delivery (the dual-track contract).
- **Crossing into delivery without both handoff artifacts** (mockup + acceptance) — the discovery gate exists to prevent it.
- **Re-implementing `run-task-lifecycle`'s Issue / branch / merge steps** — this skill is discovery-only; the lifecycle owns the outer loop.

## Related skills

- [../author-product-spec/SKILL.md](../author-product-spec/SKILL.md) · [../author-design-mockup/SKILL.md](../author-design-mockup/SKILL.md) — the two procedural halves.
- [../author-ears-spec/SKILL.md](../author-ears-spec/SKILL.md) · [../open-ears-issues/SKILL.md](../open-ears-issues/SKILL.md) — the downstream `spec-authoring` handoff.
- [../run-task-lifecycle/SKILL.md](../run-task-lifecycle/SKILL.md) — the outer loop this slots into (step 2).
- [../read-relevant-adrs/SKILL.md](../read-relevant-adrs/SKILL.md).
