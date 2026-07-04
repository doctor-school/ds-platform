---
title: "author-design-mockup"
description: "Procedural skill (inline): compose a user-facing SURFACE's layout mockup in Claude Design (DesignSync) from real design-system components, delegating any uncovered element class DOWN to the existing research-ui-element cycle, and get the product-owner's screen-composition sign-off before EARS. The screen-altitude complement of the element-class design-system-first cycle."
name: author-design-mockup
mode: inline
---

# author-design-mockup

**Kind:** procedural · **Mode:** inline (the lead runs the DesignSync macro itself and drives the owner's screen-composition pick).

This is the **screen-composition** design step of `do-product-discovery` (ADR-0014 §4–5). It composes a whole user-facing SURFACE — the events showcase, the calendar, the webinar room — as an owner-approved layout mockup in Claude Design, which becomes the spec delivery builds against.

It sits at a **different altitude** from, and **reuses**, the existing design-system-first cycle — it does not duplicate it:

- **Element-class altitude (existing, unchanged):** `build-ui-from-design-system` + the [design constitution](../../design/constitution.md) + [`research-ui-element`](../research-ui-element/SKILL.md) own the standard for each element CLASS (button, field, card, tabs …) — one researched section, owner-picked rendered options (the element-class Stage A), built into `@ds/design-system` + showcase.
- **Screen-composition altitude (this skill):** how those covered classes are ARRANGED into a surface layout, and the owner's taste pick on that arrangement. For any element class the screen needs that is not yet covered, this skill delegates DOWN to `research-ui-element` — it never invents a primitive.

The repo `@ds/design-system` stays the source of truth (ADR-0013); Claude Design is a **fed** canvas, never a second authority.

## When this applies

A `user-facing` feature during `do-product-discovery`, before EARS. **Skip** for `surface: backend-only`. This is NOT the delivery-side build — that stays in `do-feature-iteration` + `build-ui-from-design-system`.

## Input

- The feature `NNN-product.md` (stories + draft acceptance) — co-evolves with the mockup.
- The [design constitution](../../design/constitution.md) (covered classes) + `@ds/design-system` + the showcase.

## Procedure

1. **Ground in the brand + constitution first.** Read `packages/design-system/tokens/primitive.json` (Pantone anchors, e.g. `blue.700 #114D9E` = Pantone Dark Blue C) + the brandbook (`apps/docs/brandbook/`), and skim the constitution for which element classes are already covered — so composition reuses settled standards, not re-litigates them.
2. **Sync the Claude Design canvas.** Ensure a claude.ai design-system project ("DS Platform") exists (`DesignSync` `list_projects` / `create_project`); push the repo's covered tokens + primitives + blocks up as preview cards via the `/design-sync` skill — **component by component, never a wholesale replace**. Direction is one-way for the SoT: **repo → canvas**. The canvas then composes REAL components.
3. **Compose the surface layout** from the pushed cards — wireframe → hi-fi — against the feature's stories and its states (content + interaction, per ADR-0013 §7). The mockup and the PRD draft-acceptance sharpen each other; loop back to `author-product-spec` when the design reveals a missing or wrong story.
4. **Uncovered element class → delegate DOWN, do not invent.** If the screen needs an element class not yet a section in the constitution, dispatch `research-ui-element` (the existing cycle: whitelist + web-first research → owner picks the element option → constitution section → build into `@ds/design-system` + showcase), then compose the result into the mockup. A primitive is **never** originated in Claude Design — repo is SoT (AGENTS.md §6 "build the prerequisite first, no untracked seam").
5. **Screen-composition Stage A — the owner's LAYOUT pick, in claude.ai/design.** The taste-work happens in **claude.ai/design** (the Claude Design app, fed by the synced canvas of step 2), never a static chat mockup or a text questionnaire: hand the owner a prompt package (the feature's IA/flows, the `US-N` stories, the brand tokens, and the pushed component cards as building blocks) and **explicitly trigger** them to pick the arrangement/layout there — 2–3 options where a composition choice is genuinely open. This is a **distinct** decision from the element-class Stage A that `research-ui-element` settles per class: here the owner approves _how the surface is composed_, not _what a button is_. **Record the pick as an artifact** in `NNN-product.md`. A handoff-asserted "approved" is unverified — re-confirm with the live owner. **Owner-facing framing:** present this handoff in the owner's terms — who does what, in which app («я наполню ваш дизайн-проект материалами из репо; дизайн вы делаете на канвасе Claude Design») — never as a bare internal tool-name verb («запустить DesignSync»); tool mechanics belong in the tech appendix of the report (retro c75c570f-F3: the tool-name framing cost a full owner Q&A cascade).
6. **Hand the approved mockup to delivery.** Record its reference in `NNN-product.md`. Delivery (`do-feature-iteration` + `build-ui-from-design-system`) builds THAT layout from `@ds/design-system`; the element-class cycle handles any per-element work; **Stage B** (live-verify on the running stand) runs at merge — unchanged, and never substituted by the claude.ai/design pick.

## Output

- An owner-approved surface-layout mockup (rendered, on real tokens), referenced in `NNN-product.md`.
- Any uncovered element classes routed through `research-ui-element` → constitution + `@ds/design-system` + showcase (their own iterations).
- The Claude Design "DS Platform" project synced with the repo component set.

## Failure modes

- **Originating a primitive in Claude Design** instead of delegating to `research-ui-element` — repo is SoT (ADR-0013, ADR-0014 §4).
- **Duplicating the element-class cycle** — re-researching a covered class or re-deciding a button here; this skill is composition-altitude only.
- **A wholesale push / replace** of the library — `/design-sync` is incremental, component by component.
- **Presenting Stage A as text options or a static chat mockup** instead of the owner's pick in claude.ai/design — the owner composes and picks on the fed canvas.
- **Treating a handoff "approved" as sufficient** — re-confirm the pick with the live owner; record the artifact.
- **Running this for a `backend-only` feature** — there is no mockup; go straight to `author-ears-spec`.

## Related skills

- [../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md) · [../research-ui-element/SKILL.md](../research-ui-element/SKILL.md) — the element-class cycle this composes on top of and delegates to.
- [../do-product-discovery/SKILL.md](../do-product-discovery/SKILL.md) — the orchestrator that runs this.
- [../report-task-outcome/SKILL.md](../report-task-outcome/SKILL.md) — the end-of-task report shape; the Stage-A artifact itself is the owner's recorded pick in claude.ai/design, not a delivered screenshot.
