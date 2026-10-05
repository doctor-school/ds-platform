---
title: "author-design-mockup"
description: "Procedural skill (inline): compose a user-facing SURFACE's layout mockup in Claude Design (DesignSync) from real design-system components, delegating any uncovered element class DOWN to the existing research-ui-element cycle, and get the product-owner's screen-composition sign-off before EARS. The screen-altitude complement of the element-class design-system-first cycle."
name: author-design-mockup
mode: inline
---

# author-design-mockup

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline (the lead checks and uses the available design-canvas capability and drives the owner's screen-composition pick).

This is the **screen-composition** design step of `do-product-discovery` (ADR-0014 §4–5). It composes a whole user-facing SURFACE — the events showcase, the calendar, the webinar room — as an owner-approved layout mockup in Claude Design, which becomes the spec delivery builds against.

It sits at a **different altitude** from, and **reuses**, the existing design-system-first cycle — it does not duplicate it:

- **Element-class altitude (existing, unchanged):** `build-ui-from-design-system` + the [design constitution](../../design/constitution.md) + [`research-ui-element`](../research-ui-element/SKILL.md) own the standard for each element CLASS (button, field, card, tabs …) — one researched section, owner-picked rendered options (the element-class Stage A), built into `@ds/design-system` + showcase.
- **Screen-composition altitude (this skill):** how those covered classes are ARRANGED into a surface layout, and the owner's taste pick on that arrangement. For any element class the screen needs that is not yet covered, this skill delegates DOWN to `research-ui-element` — it never invents a primitive.

The repo `@ds/design-system` stays the source of truth (ADR-0013); Claude Design is a canvas that **follows the repo**, never a second authority.

## When this applies

A `user-facing` feature during `do-product-discovery`, before EARS. **Skip** for `surface: backend-only`. This is NOT the delivery-side build — that stays in `do-feature-iteration` + `build-ui-from-design-system`.

## Input

- The feature `NNN-product.md` (stories + draft acceptance) — co-evolves with the mockup.
- The [design constitution](../../design/constitution.md) (covered classes) + `@ds/design-system` + the showcase.

## Procedure

**Claude Design rules:** every Claude Design step below — the canvas inventory, the prompt, its provenance and the vendoring — follows [`operate-claude-design`](../operate-claude-design/SKILL.md); read it in full first. This skill keeps only the discovery-time procedure. **Capability preflight:** discover the actual live design connector before step 0; a missing inventory capability is a prerequisite — report it and stop the dependent steps, without replacing Claude Design or manufacturing approval.

0. **Canvas-inventory precondition (hard gate — before any Stage-A ask or "new block" claim).** Run the inventory in `operate-claude-design` → «Canvas inventory first». Interaction affordances (menus, nav, account entry) written into a PRD MUST **cite the canvas element** they derive from (e.g. "avatar icon → profile, per `account-my-events.dc.html`"), never a brainstorm inference. After a reconciliation pass, `grep` the retired term across the PRD set (EN+RU) for residual stale wording.
1. **Ground in the brand + constitution first.** Read `packages/design-system/tokens/primitive.json` (Pantone anchors, e.g. `blue.700 #114D9E` = Pantone Dark Blue C) + the brandbook (`apps/docs/brandbook/`), and skim the constitution for which element classes are already covered — so composition reuses settled standards, not re-litigates them.
2. **Compose from the design system and the project canon.** The drawing composes from the components and tokens of «Doctor.School Design System» (published from `@ds/design-system`) and the canvases already in the project, per `operate-claude-design` → «Where context lives»: components by export name, reuse units from the `unit-*` canvases.
3. **Compose the surface layout** from the `unit-*` canvases — wireframe → hi-fi — against the feature's stories and its states (content + interaction, per ADR-0013 §7). The mockup and the PRD draft-acceptance sharpen each other; loop back to `author-product-spec` when the design reveals a missing or wrong story.
4. **Uncovered element class → delegate DOWN, do not invent.** If the screen needs an element class not yet a section in the constitution, dispatch `research-ui-element` (the existing cycle: whitelist + web-first research → owner picks the element option → constitution section → build into `@ds/design-system` + showcase), then compose the result into the mockup. A primitive is **never** originated in Claude Design — repo is SoT (AGENTS.md §6 "build the prerequisite first, no untracked seam").
5. **Screen-composition Stage A — the owner's LAYOUT pick, in claude.ai/design.** The taste-work happens in **claude.ai/design**, never a static chat mockup or a text questionnaire: write the prompt from the `operate-claude-design` template (the feature's IA/flows and `US-N` stories as content; 2–3 options only where a composition choice is genuinely open), post it on the drawing Issue, and **explicitly trigger** the owner to pick the arrangement there. This is a **distinct** decision from the element-class Stage A that `research-ui-element` settles per class: here the owner approves _how the surface is composed_, not _what a button is_. **Record the pick as an artifact** in `NNN-product.md`. Verify a handoff claim against the original owner decision and scope; ask only when missing or changed.
6. **Hand the approved mockup to delivery.** Record its reference in `NNN-product.md`. Delivery (`do-feature-iteration` + `build-ui-from-design-system`) builds THAT layout from `@ds/design-system`; the element-class cycle handles any per-element work; **Stage B** (live-verify on the running stand) runs at merge — unchanged, and never substituted by the claude.ai/design pick.

## Output

- An owner-approved surface-layout mockup (rendered, on real tokens), referenced in `NNN-product.md`.
- Any uncovered element classes routed through `research-ui-element` → constitution + `@ds/design-system` + showcase (their own iterations).

## Failure modes

- **Claiming a "new block" or asking a Stage-A question before the canvas inventory** — step 0 runs FIRST (#779: the header + discovery front-door were already in the canvas).
- **Originating a primitive in Claude Design** instead of delegating to `research-ui-element` — repo is SoT (ADR-0013, ADR-0014 §4).
- **Duplicating the element-class cycle** — re-researching a covered class or re-deciding a button here; this skill is composition-altitude only.
- **Presenting Stage A as text options or a static chat mockup** instead of the owner's pick in claude.ai/design — the owner composes and picks on the project canvas.
- **Treating a handoff "approved" as sufficient** — resolve the original decision and record the artifact; re-confirm only absent, ambiguous or changed scope.
- **Running this for a `backend-only` feature** — there is no mockup; go straight to `author-ears-spec`.

## Related skills

- [../operate-claude-design/SKILL.md](../operate-claude-design/SKILL.md) — the Claude Design rules, prompt template and vendoring this procedure uses.
- [../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md) · [../research-ui-element/SKILL.md](../research-ui-element/SKILL.md) — the element-class cycle this composes on top of and delegates to.
- [../do-product-discovery/SKILL.md](../do-product-discovery/SKILL.md) — the orchestrator that runs this.
- [../report-task-outcome/SKILL.md](../report-task-outcome/SKILL.md) — the end-of-task report shape; the Stage-A artifact itself is the owner's recorded pick in claude.ai/design, not a delivered screenshot.
