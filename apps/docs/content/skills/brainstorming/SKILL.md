---
title: "brainstorming"
description: "Refine product or architecture scope through dialogue and a concrete approved design, then return to the project SDD orchestrator."
name: brainstorming
mode: inline
---

<!-- Adapted from https://github.com/obra/superpowers skills/brainstorming/SKILL.md,
Jesse Vincent, superpowers v6.3.0, MIT. Vendored 2026-09-01 (#1700).
Project adaptations: scoped authorization, catalog-only routing, SDD triplet,
project spec paths, no unvendored visual server, detailed process extracted.
Update by re-vendoring with these adaptations; never re-enable the vendor pack. -->

# Brainstorming ideas into designs

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline. Invoked by `author-feature-spec` / `do-product-discovery`; this skill does not own the task lifecycle.

## Entry and approval scope

Read governing ADRs and the current-system summary first. Explain the scope and intended outcome, then classify the work. An explicit owner approval already recorded in this session applies to its exact scope: do not stop again merely because this skill was loaded. Routine implementation/architecture sequencing inside that authorization is the lead's responsibility. An unresolved product-scope/design choice still requires the owner's explicit decision before dependent implementation; approval of a spike does not authorize retaining its code.

Stage A before UI code and Stage B before merge remain mandatory under `build-ui-from-design-system`, including its exact carve-outs. A brainstorm answer is not a substitute for those visual artifacts. A technical/bounded label never waives AGENTS.md SDD or TDD requirements.

## Classify and follow one path

- **Spike:** a feasibility question with findings as the deliverable. State the concrete probe and authorized bounds, investigate, then report evidence/limitations. No retained production code without the normal spec and TDD path.
- **Bounded:** an existing flow with a narrow change. Read it, resolve material uncertainties, present the concrete delta and verification in a short design. Confirm only new owner decisions; continue through the calling lifecycle once authorized. Do not create an extra implementation-plan document or use this path to skip a required spec.
- **Architectural:** new subsystem or changed interfaces/boundaries. Read [process-reference.md](process-reference.md) in full; explore 2–3 approaches, explain tradeoffs, resolve product decisions one at a time, write the agreed design in the project spec tree, self-check it and obtain the owner's review of the concrete artifact before downstream authoring.

If new complexity changes the authorized scope, surface that change before dependent work; do not silently expand it. Keep unrelated refactors out. Independent subsystems get separate bounded deliverables and ownership; no artificial `blocked_by` edges just to order them.

## Dialogue and design checks

Use the active harness's permitted question mechanism. Ask only the material unresolved fork, one at a time; record the owner's words and scope in the tracker/spec. Technical/architecture choices follow the loaded ADRs. Propose options with your recommendation and evidence, not a questionnaire of routine implementation choices.

Design against the existing system and shared capability registry. Cover responsibilities, public interfaces, data flow, error handling and verification. Prefer small units with one purpose and explicit dependencies. Drop speculative features.

Before presenting the written design, check placeholders, contradictions, scope and ambiguous requirements. Fix them in the artifact; this author self-check does not replace independent Mode (a) review. If an owner asks to change the design, update the concrete artifact and re-check only the affected decisions.

## Exit contract

Return the approved decisions, provenance and design path to the invoking orchestrator. Product discovery continues through PRD + approved mockup; feature-spec authoring dispatches `author-ears-spec`. The SDD triplet is the implementation plan; never chain into a global plan-writing or implementation skill. A spike returns findings; a bounded change continues through its applicable project lifecycle and TDD.
