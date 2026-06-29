---
title: "DS Platform — Design-System Living Showcase (Design)"
description: "A lightweight, route-rendered living showcase for @ds/design-system as a dedicated minimal Next app (apps/showcase): renders every token + every primitive/block in every state from the real package, served as a live URL on the dev stand. Doubles as the Stage-A research-options surface and the Stage-B owner-approval surface; kept honest by a coverage lint guard and the existing Playwright+axe runtime checks retargeted onto it. Storybook and visual-regression stay deferred until ADR-0004 OQ-F9 triggers."
slug: design-system-showcase
status: In design
tracker: https://github.com/doctor-school/ds-platform/issues/340
lang: en
---

# DS Platform — Design-System Living Showcase (Design)

**Date:** 2026-06-29
**Status:** In design (brainstorm output of epic #340 deliverable B — spec → child Issues; deliverables A/C are inline skill/ADR edits, out of this spec)
**Type:** Platform-level frontend tooling design (living style guide / design-system SSOT surface).
**Applies (not inherits):** ADR-0013 (design-token SoT), ADR-0004 (frontend stack — Next.js + Tailwind v4 + shadcn/ui; OQ-F9 Storybook trigger), design-system-foundation tech-spec (§3.2 deferral this supersedes for the showcase layer).

---

## 1. Context & problem

Across multiple sessions the same class of UI defects keeps recurring (spacing/rhythm, error language & colour, hover, `cursor-pointer`, interaction states) — see #237, #322/#333. The root cause is **not** missing standards: ADR-0013 §7/§8 and the `build-ui-from-design-system` skill are mature. Epic #340 names four process gaps; deliverable **B** addresses the one this spec owns:

> **There is no living visual catalogue.** The owner can only review design embedded late in a feature screen; element-level look gets re-litigated every feature. Research options are presented (when at all) ad-hoc and thrown away after the PR.

The design-system-foundation tech-spec consciously deferred a showcase (§3.2) under ADR-0004 OQ-F9 (trigger: ≥2 frontend developers **or** >20 components). Neither condition holds today (solo Tech Lead, ~12 primitives/blocks), so the deferral was **correct by best practice** — not a gap. What changed is the _use case_: the owner now needs a single live URL to (a) pick research-backed options before a class is built (Stage A) and (b) approve the design system **as a unit, once** (Stage B), instead of re-approving look per feature.

### 1.1. Research basis (best-practice grounding)

A June-2026 review of current best practice (sources in §9) establishes:

- **Storybook is the industry SSOT for living style guides — but the consensus is scale-bound, not unconditional.** "Do not build a documentation site before you have three engineers using the components… A two-person team knows everything." At ~5 components a README + a few stories suffice; the deliberate transition to a dedicated documentation site lands around the **15–20 component** threshold. This maps exactly onto ADR-0004 OQ-F9.
- **The isolated Storybook environment is _not_ the most suitable platform for non-technical stakeholders** (designers, PMs, brand owners). Our actual approver — the Product Lead — is non-technical, so a stakeholder-facing rendered showcase is _more_ aligned with the Stage-A/B approval use case than Storybook would be.
- **The project's own primitive source (shadcn/ui) presents its living showcase as a Next/docs site, not Storybook.** A route-rendered showcase is the conventional shape at this scale.
- **Ladle/Histoire are lighter than Storybook but still net-new isolated tooling** with no official MCP and a smaller ecosystem — they buy story-DX we do not yet need.

**Conclusion.** Build the showcase as a lightweight, route-rendered surface now; let Storybook (with its MCP and visual-regression addons) arrive when OQ-F9 honestly triggers. This spec records that future as an explicit re-trigger, not a forgotten deferral.

**Decided / out of scope (not re-litigated):** the token SoT, the DTCG→Style-Dictionary→Tailwind-v4 pipeline, and owned-code block reuse (ADR-0013, foundation spec) stay as-is. This spec does **not** introduce Storybook, Ladle, or visual-regression. Deliverables A (`research-ui-element` subagent + design constitution) and C (debloat `build-ui-from-design-system` + wire the cycle + extend the anti-bloat budget to skills) are **inline skill/ADR edits tracked separately under #340** — this spec defines only the _surface_ they plug into (§4).

---

## 2. Architecture & host

### 2.1. Dedicated minimal app — `apps/showcase` (`@ds/showcase`)

The showcase is a new minimal Next 15 App-Router app at `apps/showcase`, package name `@ds/showcase`, depending on `workspace:@ds/design-system`. It is the design system's own SSOT home.

**Why a dedicated app, not a route in an existing one** (architecture, not convenience):

- A design-system showcase must not live inside one of the system's **consumers** (`apps/portal`) — that inverts the dependency direction semantically and would force a dev-only route guard to keep an internal tool out of the product bundle/navigation (a banned workaround, AGENTS.md §6).
- It must not couple the **docs content app** (`apps/docs`, Fumadocs) to `@ds/design-system`: docs has no DS dependency today and renders MDX content, not live interactive primitives. Adding a DS dependency + duplicating the Tailwind v4 `@theme`/`@source` pipeline into the docs build is net-new coupling for no benefit.
- A dedicated app keeps the dependency direction clean (`showcase → @ds/design-system`), owns its coupling explicitly, and is the natural future home for Storybook / visual-regression when OQ-F9 triggers — they replace or augment the app shell without disturbing a product or docs app.

The cost is a one-time minimal Next-app scaffold + a build target. This is far lighter than Storybook and is paid once.

### 2.2. Styling pipeline — mirror portal, no new pipeline

`apps/showcase/app/globals.css` mirrors `apps/portal/app/globals.css`: it imports the same compiled token CSS (`@ds/design-system` `tokens.css`/`globals.css`) and uses the same Tailwind v4 `@theme`/`@source` wiring. The showcase renders **the real `@ds/design-system` components** through **the same render pipeline as features** — a green in the showcase is a green for the components features will compose. No bespoke re-implementation of any primitive is permitted in the showcase (that would defeat its purpose).

### 2.3. Serving — live URL on the dev stand

The app is driven by the existing `pnpm dev:*` launcher (env-driven, reads `.env.local`), so it comes up on the dev stand as a stable live URL alongside the other apps. The owner opens that URL for Stage-A and Stage-B review. Endpoints/ports are recipe-specific and read from `.env.local`, never hardcoded (`.claude/rules/dev-stand.md`). Live-verify pre-flight (`pnpm dev:status` → `pnpm dev:up`) is the agent's to run.

### 2.4. One design system, not two — the showcase is a viewer (anti-drift guarantee)

There is exactly **one** design system: `packages/design-system` (`@ds/design-system`). The showcase is **not a second design system** — it is the rendered _viewer_ of the one the product apps already consume.

```
        packages/design-system  (@ds/design-system)   ← the single source: tokens + primitives + blocks
                 ▲                          ▲
     workspace:* │                          │ workspace:*
            apps/portal                apps/showcase
   (product: composes from the DS)   (viewer: renders the SAME DS, adds nothing of its own)
```

Drift is **structurally impossible**, not merely discouraged:

- The showcase imports the **same exports** of `@ds/design-system` over `workspace:*` that `apps/portal` does — same version, same compiled tokens. §2.2 forbids the showcase from re-implementing any primitive. So `showcase ≡ what the product apps render`, **by construction** — there is nothing separate to diverge.
- The **coverage guard** (§5.1) machine-asserts every package export has a showcase entry → the viewer cannot silently lag the system.
- The **retargeted Playwright + axe** (§5.2) exercise behaviour across the whole catalogue.

The isolation chosen in §2.1 isolates only the **hosting Next shell** (so an internal tool does not pollute the product app and docs stays decoupled). It does **not** isolate the design system, which is single and shared. The dependency binding is identical whether the showcase is a dedicated app or a route inside a consumer — the bond is the shared package, not the hosting location.

**How a coding agent works against it (the full cycle, with deliverables A/C).** All UI is adopted from `@ds/design-system` (AGENTS.md §6, adopt-before-bespoke). For an element class **not yet covered**: the `research-ui-element` subagent (A) renders 2–3 researched options into the showcase candidate seam (§4) → the owner picks on the live URL (Stage A) → the choice is encoded as a standard in the design constitution (generalised ADR-0013 §7, A) → it is implemented into `@ds/design-system` as a token-only primitive/block → it appears in the showcase → the owner approves the catalogue (Stage B). For an element class **already covered**: the agent reuses the package export and consults the showcase (the rendered look) + the constitution (the rule) — no re-research. Features always compose from the package; the debloated `build-ui-from-design-system` (C) is the thin procedure that points the agent at the showcase + constitution; the coverage guard plus the anti-bloat budget extended to skills keep the surface and the skill from re-bloating.

---

## 3. Content & structure (minimal-first)

Three sections, all rendered by the real package. Scope v1 = the current inventory; the catalogue grows with the system and is kept complete by the coverage guard (§5.1).

### 3.1. Tokens

Every token class rendered as swatches/specimens: color, typography (family / size / weight / line-height / letter-spacing), spacing scale, radius, border-width, shadow/elevation, motion (duration / easing), z-index, opacity, breakpoints. The data source is the **generated token manifest** (`packages/design-system/src/styles/allowed-tokens.json` and/or the compiled CSS custom properties), **not hardcoded values** — the tokens page cannot drift from the SoT.

### 3.2. Primitives

Each exported primitive — button, card, input, input-otp, link, label, tabs, form, and the `fields/*` set — rendered across **every state**: default / hover / focus / active / disabled / error, multiplied by its variants and sizes. States are shown with the real interactive component plus an explicit **states column** so a static read (and a screenshot) covers states that normally require pointer interaction. Deterministic hover/active/focus capture follows the forced-pseudo-state isolation discipline (memory `reference_cdp_forced_pseudo_state_isolation`): probe synthetic elements in one CDP session, clear between, trust computed-styles + forced-pseudo only.

### 3.3. Blocks

Each exported block — `auth-card`, `auth-layout`, `otp-focus-screen` — rendered with representative content in its key states. Blocks render with their real composed primitives, branded.

---

## 4. Dual-surface contract (Stage-A options + Stage-B approval)

The showcase is the single live URL behind both design gates of `build-ui-from-design-system` (AGENTS.md §6 two-stage gate):

- **Stage A (options).** Before an element class is built, research-backed options are presented for an owner pick. This spec defines the **seam** the showcase exposes for that: a convention for rendering a _candidate / proposed_ option-set (2–3 variants of an element class) **side by side with the adopted** entry, visibly labelled. Deliverable A's `research-ui-element` subagent renders its 2–3 options **into this seam**; the owner picks on the live URL; the chosen option is then encoded as a standard (design constitution, deliverable A) and the candidate entries are removed/promoted to adopted.
- **Stage B (approval).** The rendered, branded, adopted catalogue is the surface the owner re-confirms before merge. Approving the showcase approves the design system as a unit — element look is no longer re-litigated per feature.

**Boundary:** this spec owns only the _surface contract_ (the candidate/adopted convention and where it lives). The `research-ui-element` subagent, the design constitution, and the cycle wiring are **deliverables A/C (inline edits under #340)**, not WBS items here. The contract is: anything A produces is renderable into the showcase seam with no schema change to the surface.

---

## 5. Keeping it honest (machine-enforced "living")

A catalogue that drifts from the system is worse than none. Two mechanisms, both reusing existing patterns, replace the "3+ engineers keep the docs alive" social guarantee:

### 5.1. Coverage guard (lint)

A lint guard (built and tested on the established harness, `reference_lint_guard_test_harness` — `tools/lint/*.ts` + `@ds/lint-guard-tests` + `LINT_FIXTURE_ROOT` + `spawnSync` exit-code assertions) asserts that **every export of `@ds/design-system` has a corresponding entry in the showcase registry**. A new primitive/block added to the package without a showcase entry fails the guard. WARN in Phase 0, consistent with the other guards (ADR-0007 §2.6). This is the technical substitute for the social "living" guarantee.

### 5.2. Runtime checks retargeted onto the showcase

The foundation spec's §3.2 runtime substitute (a Playwright interaction smoke asserting `cursor:pointer`/`not-allowed`, a hover delta, a visible focus ring; an axe-core a11y scan) is **retargeted from the auth surfaces onto the showcase**. Because the showcase renders every primitive/block in every state in one place, this extends machine-checked interaction + a11y coverage from auth-only to the **whole design system** — a strict superset of today's checks. The `playwright-axe` BLOCK gate (#285) and the `interaction-states` guard continue to apply.

### 5.3. Visual-regression — deferred (explicit re-trigger)

Pixel/visual-regression (Chromatic / Storybook test-runner / Lost-Pixel-class) stays **deferred**, honestly tied to ADR-0004 OQ-F9 (≥2 frontend developers **or** >20 components). When OQ-F9 triggers, the dedicated `apps/showcase` is the place visual-regression and Storybook (+ its MCP) are introduced. Recorded here as an explicit re-trigger, not a silent gap.

---

## 6. WBS → child Issues (under epic #340)

Each becomes a sub-issue of #340 with native blocked-by/blocking links (repo-conventions). Ordering reflects dependencies.

1. **Scaffold `apps/showcase`** — minimal Next 15 App-Router app, `@ds/showcase`, depends on `@ds/design-system`; `globals.css` mirrors portal's token wiring; `pnpm dev:*` serves it on the stand. _(blocks 2–7)_
2. **Tokens section** — render all token classes from the generated manifest. _(blocked-by 1)_
3. **Primitives section** — every primitive × every state/variant/size, with the states column. _(blocked-by 1)_
4. **Blocks section** — auth-card, auth-layout, otp-focus-screen in key states. _(blocked-by 1, 3)_
5. **Candidate/adopted seam** — the Stage-A option-set convention (§4). _(blocked-by 3)_
6. **Coverage guard** — lint guard + harness tests (§5.1). _(blocked-by 3, 4)_
7. **Retarget Playwright + axe onto the showcase** + dev-stand serve wiring (§5.2). _(blocked-by 2, 3, 4)_

### 6.1. Companion inline edits (NOT WBS items — deliverables A/C, tracked separately under #340)

For traceability only; these are skill/ADR edits, not showcase Issues:

- **A:** new `research-ui-element` subagent skill; generalise ADR-0013 §7 into a per-element-class **design constitution**.
- **C:** debloat `build-ui-from-design-system` to a thin procedure pointing at the constitution + showcase; wire the cycle into `run-task-lifecycle` step 2; extend the anti-bloat budget (or a `/wrap` skill-bloat audit) to `apps/docs/content/skills/**` (per the #340 root-cause comment).

### 6.2. Documentation alignment

The foundation tech-spec §3.2 is **rewritten inline** (no amendment block — pre-pilot, AGENTS.md §6): from "no Storybook this iteration" to "showcase implemented as a lightweight route-app (`apps/showcase`); Storybook + visual-regression remain deferred until ADR-0004 OQ-F9." ADR-0013 §7 gains a pointer to the showcase as the rendered SSOT surface.

---

## 7. Components & boundaries

| Unit                         | Does                                                    | Depends on                                |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `apps/showcase` shell        | Next app, routing, token CSS wiring, dev-stand serve    | `@ds/design-system`, Tailwind v4          |
| Tokens section               | render token specimens from the manifest                | generated token manifest                  |
| Primitives / Blocks sections | render real components × states                         | `@ds/design-system` exports               |
| Showcase registry            | the list of catalogued exports the coverage guard reads | section files                             |
| Candidate/adopted seam       | render proposed option-sets beside adopted              | registry convention                       |
| Coverage guard               | assert every export is catalogued                       | registry + `@ds/design-system` export map |
| Retargeted Playwright+axe    | interaction + a11y over the whole catalogue             | showcase live URL                         |

The **showcase registry** is the seam between "what the package exports" and "what is catalogued" — the coverage guard reads it, the candidate/adopted seam extends it, and deliverable A renders into it. Keeping it a single declarative list is what lets all three stay decoupled.

---

## 8. Testing

- **Coverage guard** — harness tests (fixtures: an export with/without a registry entry → exit-code assertions), per `reference_lint_guard_test_harness`.
- **Runtime** — Playwright interaction smoke + axe-core scan over the showcase (retargeted), `playwright-axe` BLOCK.
- **Live-verify** — the showcase is itself the live-verify surface for the design system; the agent drives it on the stand before declaring any showcase Issue done (AGENTS.md §6; memory `feedback_verify_ui_on_live_stand`).
- No bespoke unit tests for rendered primitives — they are tested in `@ds/design-system`; the showcase asserts only catalogue completeness and runtime behaviour.

---

## 9. Research sources

- Fordel Studios — _Design Systems from Scratch: A Small Team Playbook_ (scale thresholds: write docs at the 3rd engineer / 15–20 components).
- zeroheight — _Should you document your design system in Storybook?_ (Storybook's isolated env is poorly suited to non-technical stakeholders).
- Storybook — _4 ways to document your design system with Storybook_ (Storybook as the team-scale SSOT).
- dev.to / Ladle — Storybook 10 vs Ladle vs Histoire (2025): Storybook's ecosystem advantage vs lighter Vite runners for small scale/prototypes.
- shadcn/ui — living showcase presented as a Next/docs site (the project's own primitive source).
