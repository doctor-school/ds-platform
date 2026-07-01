---
title: "build-ui-from-design-system"
description: "Procedural skill (inline): the thin gate that runs the design-system-first cycle before any UI — reuse a covered element class from the design constitution, or research it (research-ui-element) first; adopt from the whitelist before bespoke; token-only; owner Stage A/B design approval; live-verify."
name: build-ui-from-design-system
mode: inline
---

# build-ui-from-design-system

**Kind:** procedural · **Mode:** inline (the lead agent executes this procedure itself).

The design system exists so we **do not reinvent the wheel**. This skill is the **thin gate** that runs the design-system-first cycle — it does not restate the standards themselves. Durable standards live in one store each, and this skill **points** at them:

- **[Design constitution](../../design/constitution.md)** — the per-element-class standards + research + citations (the _what_ and _why_).
- **ADR-0013 §7** — the decision (layered interaction/motion contract) + the CI guard catalogue.
- **`@ds/design-system` README** — the concrete token-only classes.
- **Living showcase** (`apps/showcase`) — every primitive/block rendered in every state (the Stage-A option surface + the Stage-B approval surface).

Canon: **ADR-0013** + ADR-0004 §6.

## The design-system-first cycle (the default path)

Every UI-shaped task runs this loop; the gates below enforce each arrow:

> **element class covered in the constitution?** → **yes:** reuse the package export + consult the showcase (look) and constitution (rule) — no re-research. **no:** dispatch [`research-ui-element`](../research-ui-element/SKILL.md) → owner picks a rendered option (**Stage A**) → encode the standard into the constitution → build it into `@ds/design-system` as a token-only primitive/block, rendered in the showcase → owner approves live (**Stage B**) → feature composes from the package → **live-verify** → merge.

Features always compose from `@ds/design-system`; bespoke is the last resort, recorded.

## When this applies

Any task that creates or reshapes an interface — a page, form, control, layout, overlay, or an empty/error/loading state. **Classify by the touched SURFACE, not the GitHub label**: a `tooling` / `engineering-task` framing never exempts a user-facing look, and this **includes a catalogue / showcase / doc surface** that renders the design system itself (`apps/showcase/**`) — its look is a product decision too (memory `feedback_classify_by_surface_not_label`; the #348→#386 reopen).

It also includes a **UI-quality-fix round** (spacing / state / hover / reflow defects): research the best-practice values, encode them as a **primitive-level standard** in the constitution, never reactive per-page patches. **A styling fix repeated across ≥2 call-sites is decision-debt — lift it into a design-system primitive (ONE style source), never edit a per-page `className`** (memory `feedback_research_backed_ui_standards`; the #333 `FormError` lesson).

## Procedure

1. **Frame the unit + its states.** Name the UI unit and enumerate its content states (default / filled / invalid / loading / empty / disabled) **and interaction states** (hover / focus-visible / active / `cursor-pointer` on every clickable) per the ADR-0013 §7 contract. You adopt against the _states_, not a happy-path screenshot. For a DS primitive, run `pnpm lint:interaction-states` (#269) — it machine-checks the base-reset + hover/focus ring, but does **not** replace the live audit (step 8).
2. **Reuse or research (the cycle's fork).** Is the element class already a `researched` section in the [constitution](../../design/constitution.md)? **Covered** → reuse the `@ds/design-system` export, read the constitution (rule) + showcase (look); skip to step 5. **Not covered** → dispatch [`research-ui-element`](../research-ui-element/SKILL.md); its returned section is the Stage-A artifact.
3. **Inventory owned code.** Check `@ds/design-system` (`tokens/`, `src/primitives/`, `src/blocks/`). Use what exists; don't re-create it.
4. **Registry-research gate (before any bespoke).** Search the committable whitelist and **report what you searched and found**: ① official **shadcn/ui** (Radix, incl. `input-otp`) · ② **Origin UI** · ③ **Intent UI / JollyUI** (React-Aria) · ④ **Kibo UI**. (research-ui-element already did this for a freshly-researched class — cite its result.)
5. **License guard.** Our product is proprietary (`UNLICENSED`; ADR-0008 §2.3 = source-available, not open-source). **MIT/permissive** (the whitelist) — adopt freely, preserve the upstream notice. **Proprietary/paid** (shadcnblocks, Shadcn Studio, shadcn Pro) — license **+** private repo only; while public, pattern-only. **Runtime UI-kits** (HeroUI, CoreUI, Syncfusion) — excluded (foreign runtime).
6. **Adopt → re-skin to tokens.** Install as owned code → re-skin token-only (no hardcoded colour/spacing/radius — lint-blocked) → place in `src/primitives/` or `src/blocks/`. Acceptance bar (ADR-0013): permissive license · correct RSC boundaries · a11y · no superfluous deps · maintenance freshness.
7. **App glue stays in the app.** BFF calls, EARS-16 generic errors, i18n copy, routing, validation wiring — never in the block; the block is the presentation scaffold.
8. **Live-verify.** Confirm the stand is up **yourself** (`pnpm dev:status`; bring it up if down — the box is power-cycled, never ask "is the box on?" — `.claude/rules/dev-stand.md`). Then drive the journey in a browser (Playwright): every clickable's hover (pointer cursor **and** style change) + Tab focus ring + active/disabled/loading, and **every branch** of an action, not just the green path (memories `feedback_verify_ui_on_live_stand`, `feedback_verify_every_field_kind_every_surface`). Build/typecheck/lint/Mode-a are necessary, not sufficient.
9. **Bespoke is the last resort** — only after step 4 comes up empty, with the negative search result recorded in the PR.

## Design-approval gate (user-facing surfaces)

The _look_ is a product (taste) decision — the product owner's, not the lead's best-architecture call (AGENTS.md §6). Two non-bypassable check-ins wrap the procedure; for a `user-facing` task they gate the lifecycle (`run-task-lifecycle` step 2 — Stage A precedes board→In-Progress + branch). Detail + failure lessons: memory `feedback_ui_design_product_approval`.

**Stage A — before any UI code (after step 4).**

- **Brand SoT first.** Read `packages/design-system/tokens/primitive.json` (Pantone annotations name the registered brand anchors, e.g. `blue.700 #114D9E` = Pantone Dark Blue C) + the brandbook **before** generating options — it avoids wasted rounds.
- **Present 2–3 RENDERED options, owner picks.** Build a focused HTML preview with real tokens — **informed by a `frontend-design` skill pass** (visual direction + the interaction floor: hover/focus/cursor/reduced-motion) — screenshot, and deliver it (recipe: [`report-task-outcome`](../report-task-outcome/SKILL.md)) — a text `AskUserQuestion` of colour/layout options is **not** a valid look proposal. Research (web-first: GOV.UK · Primer · Polaris · Carbon · React-Aria · NN/g · Baymard) comes **before** the preview; a "research-backed standard" that only cites sources without an owner-facing pick does **not** satisfy Stage A (memory `feedback_research_backed_ui_standards`). Self-QA the PNG before delivering (no raw CSS as text, no overflow/column-collapse, the defect shown in the state that exhibits it).
- **Restate ambiguous feedback before re-rendering.** When the owner's verdict uses a metaphor (ноготь / склейка / каша / костыль), restate your interpretation in one line pointing at the exact element/pixel and confirm — do **not** guess-and-redraw. One restatement is cheaper than a render round-trip (#333 misread "ноготь" thrice).
- **Read the full record first.** On resume, read the **entire** issue thread (`gh issue view <N> -c`, no truncation) + body; copy every recorded design decision into the implementation checklist — the surface is not done until each is ticked (the #237 miss). A handoff-asserted "approved" is **unverified** — re-confirm with the live owner.
- **No inversion, no silent inheritance.** Record the pick as an artifact (Issue comment / `AskUserQuestion` answer) **before** engineering — never surface the design last as a finished green PR. Every inherited template default (column side, logo, form position) is an explicit kept-or-changed choice.
- **DS-doc surfaces** (catalogue / showcase / viewer): research the standard doc pattern first (Storybook · Carbon · Atlassian: realistic-but-neutral render **+** slots/props table **+** state matrix); don't invent a rendering or swing between product-mirror and raw-prop-name extremes (memory `feedback_showcase_unit_as_subject`).
- **Reopened / Nth attempt:** before authoring any option, read the prior attempts' logs/PRs and write "what was rejected + the unit's purpose"; "research" means WebFetch-ing real reference pages, not snippet assertions.

**Stage B — before live-verify / merge (around step 8).**

- **Deliver a LIVE, openable URL** on the running stand — boot api+portal from the branch's worktree **in the MAIN session background** (never in a subagent — it tears the servers down on return; memory `feedback_live_url_not_screenshots`) + the click-path for stateful steps. A screenshot is a supplement, never a substitute. An **unanswered Stage-B approval question BLOCKS the merge** (AGENTS.md §6).
- **Brand-asset preflight.** Enumerate logo/mark variants by **opening each asset** (`Read` the image), never judging by filename (#237). Use the clean white/mono variant directly on a coloured surface; a CSS invert filter or a `bg-card` chip is a banned hack (last resort only if no clean variant exists — then request it). **Assets are SVG (logos/icons) / WEBP (raster); PNG/JPG is a hygiene defect** (ADR-0013 §8). Exactly one logo per viewport.
- **On non-specific sign-off** ("fix the details"): apply the polish you already self-identified and re-present ONE updated view — don't re-query (memory `feedback_no_screenshot_reapproval_for_polish`).

A user-facing surface entering implementation with no recorded owner design sign-off is the banned shortcut.

## Output

- An explicit **adoption decision** in the first reply + PR body: `adopted <block> from <registry>` or `bespoke — toolbox search (shadcn/Origin/Intent·Jolly/Kibo) returned no fit because …`. This citation proves the gate ran (the `registry-research` guard checks for it).
- Adopted/bespoke code lives in `@ds/design-system`, token-only, live-verified; a freshly-researched class also lands a constitution section.

## Failure modes

- **Hand-writing a scaffold without the registry search** (the #235 `AuthCard` sin), or **concluding the landscape from one link** — the whitelist exists so the search is complete.
- **Committing proprietary-registry code into a public repo** (pattern-only there).
- **Skipping Stage A / inverting the gate** — entering In-Progress / branch / UI code, or surfacing the design last as a green PR, with no recorded owner sign-off; a handoff "approved" is unverified.
- **Text options instead of a rendered visual** (Stage A) or **a static screenshot instead of a live URL** (Stage B) — the owner picks/approves from what they can see and drive.
- **Skipping the `frontend-design` pass / interaction-state audit** — clickables with no hover feedback or an arrow cursor.
- **A PNG/JPG product asset or a white-chip logo when a clean variant exists** (ADR-0013 §8).
- **Declaring "done" on build/lint/review without a browser live-verify.**
- **Re-researching an already-covered element class** instead of reusing its constitution section.
