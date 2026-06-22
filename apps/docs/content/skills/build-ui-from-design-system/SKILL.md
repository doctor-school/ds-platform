---
title: "build-ui-from-design-system"
description: "Procedural skill (inline): before building ANY UI (page/form/element), run the registry-research gate over the approved MIT toolbox; adopt + re-skin to tokens; bespoke only after the search comes up empty."
name: build-ui-from-design-system
mode: inline
---

# build-ui-from-design-system

**Kind:** procedural · **Mode:** inline (the lead agent executes this procedure itself).

The design system exists so we **do not reinvent the wheel**. This skill makes adoption a _gated step_, not a good intention: every UI-shaped task passes the registry-research gate before any bespoke code is written. Canon: **ADR-0013** (design-token SoT, block adoption, the approved toolbox, the proprietary-product licensing model) and ADR-0004 §6 (frontend stack).

## When this applies

Any task that creates or reshapes an interface: a page, a form, a single field/control, a layout, an overlay, an empty/error/loading state. If the user can see it, this gate applies.

## Input

- A UI-shaped task (feature-spec surface, an Issue, or a plain description) and its target app (`apps/portal` / `admin` / `cms` / `promo`).

## Procedure

1. **Frame the unit.** Name the UI unit and enumerate its states — content states (default / filled / invalid / loading / empty / error / disabled) **and interaction states (hover / focus-visible / active / `cursor-pointer` on every clickable)** per the interaction-state contract (ADR-0013 §7 — base-reset + primitive contract + lint/runtime guards). You adopt against the _states_, not a happy-path screenshot.
2. **Inventory owned code first.** Check `@ds/design-system` — `tokens/`, `src/primitives/`, `src/blocks/`. If a fitting token/primitive/block already exists, use it. Do not re-create what the package already owns.
3. **Registry-research gate (MANDATORY before any bespoke).** Search the approved committable toolbox for a block/component matching the unit, and **report what you searched and what you found**:
   1. Official **shadcn/ui** blocks + primitives (incl. `input-otp`) — use the **Radix** variant (matches our primitives).
   2. **Origin UI** (MIT) — accessible input/field collection.
   3. **Intent UI / JollyUI** (React-Aria) — strongest a11y.
   4. **Kibo UI** (MIT) — composable advanced components.
4. **License guard.** Our product is **proprietary** — `package.json` `license: UNLICENSED`, all rights reserved; ADR-0008 §2.3 frames any opened state as **source-available, not open-source**. We keep full rights to our own code at any repo visibility, and adopting third-party code never dilutes that. Rules for the code we _adopt_:
   - **MIT/permissive** (official shadcn, Origin UI, Intent·Jolly, Kibo) — adopt freely into our proprietary product at any visibility; the only obligation is to **preserve the upstream license/copyright notice** (attribution).
   - **Proprietary/paid** (shadcnblocks, Shadcn Studio, shadcn Pro) — usable only with a purchased license **and** only in a **private** repo; never commit into a public/source-available repo (their terms forbid exposing the components for extraction). While the repo is public/source-available they are **pattern-only** — re-express the UX in permissive code.
   - **Runtime UI-kits** (HeroUI, CoreUI, Syncfusion) — excluded regardless: they break the owned-code model (a foreign runtime dependency), not a licensing issue.
5. **Acceptance bar** (ADR-0013) for an adopted block: MIT/compatible license · correct RSC boundaries (`"use client"` only where required) · accessibility · no superfluous dependencies · maintenance freshness.
6. **Adopt.** Install via the registry CLI as **owned code** → **re-skin to our tokens** (no hardcoded colors/spacing/radius — the lint guardrails block them) → place in `src/primitives/` or `src/blocks/`.
7. **App glue stays in the app.** BFF calls, EARS-16 generic errors, i18n/localized copy, routing, validation wiring — never inside the block; the block is the presentation scaffold.
8. **Live-verify.** First confirm the dev-stand is up **yourself** — `pnpm dev:status`; if it is down, bring it up (`pnpm dev:up`) and follow `.claude/rules/dev-stand.md` recovery on failure. The box is power-cycled (not 24/7), so a down stand is expected — **never ask the user "is the box on?"**, check it. Then drive the journey in a browser (Playwright) — mandatory per CLAUDE.md "UI verification". typecheck/build/lint/Mode-a review are necessary but not sufficient. Drive **interaction states**, not only field reject/accept: hover every clickable (the cursor must become a pointer **and** the style must change), Tab through for a visible focus ring, and exercise active / disabled / loading. A clickable with no hover feedback or an arrow cursor is a defect, not a pass.
9. **Bespoke is the last resort.** Build from scratch only after step 3 comes up empty, and **record the negative search result** (which registries, which candidates rejected and why) in the PR/spec so the decision is auditable.

## Design-approval gate (user-facing surfaces)

The _look_ of a user-facing surface is a product (taste) decision — approved by the product owner, not settled by the lead on best-architecture grounds (AGENTS.md §6). Two non-bypassable check-ins wrap the procedure above; for a `user-facing` task they gate the lifecycle (`run-task-lifecycle` step 2 — Stage A precedes board → In Progress + branch):

- **Stage A — before adoption / any UI code (after step 3).** Present the registry-research shortlist as a concrete choice: 2–3 candidate blocks/screens (links + reference screenshots, or an ASCII wireframe of the layout via an `AskUserQuestion` preview), with the brand direction noted — **informed by a `frontend-design` skill pass** (visual direction + the interaction quality floor: hover/focus/cursor/reduced-motion). The product owner picks by taste. Do **not** move the task to In Progress, create a branch, or write UI code before this pick.
  - **No inversion (design precedes engineering).** The design is shown and the Stage A pick is **recorded as an artifact** (Issue comment / `AskUserQuestion` answer) _before_ any engineering. Running live-verify, opening a PR, or dispatching review and then asking for the design "ok" last is the **banned inversion** — the look is settled first, never surfaced as an already-finished, green PR.
  - **A handoff approval is unverified.** A prior-session handoff claiming "Stage A approved" or paraphrasing owner feedback ("поправь детали") does **not** satisfy this gate — re-confirm the pick with the live owner before writing UI code.
  - **Deliberate-choice ledger.** When adopting a registry block, every inherited layout default (column side, logo placement, form position) is either an explicit kept-on-purpose choice or changed — **never silently inherited** from the template.
- **Stage B — before live-verify / merge (around step 8).** Build the picked option, apply our tokens + brand, then **render it and capture a screenshot** (Playwright over a throwaway preview route or the live stand) and show the product owner. Iterate until "ok". Only then run the live-verify journeys and proceed to review/merge. Storybook is deferred (spec §3.2), so the preview artifact is a Playwright screenshot, not a story.
  - **Brand-asset preflight (before the first render).** Enumerate the available logo/mark variants (colour / white / mono / icon) **by actually opening the brandbook** (`apps/docs/brandbook/logo/…`) — do not conclude a variant is missing from a filename. For a coloured surface (e.g. the blue brand panel) use the **clean white (or mono) variant directly**; a clean white logo asset usually exists (the #237 white-chip was an _unnecessary_ workaround — a clean white variant was present all along; if it is only a raster export, re-export a white **SVG** from the brand vector source rather than reaching for the chip). A CSS colour-inversion filter (`brightness-0 invert`) on a logo, or deriving a white-on-colour treatment from a gridded/construction-line export, is a banned bespoke hack. A `bg-card` token chip is a **true last resort**, only when no clean white/mono variant exists at all — and then request the missing variant rather than shipping the chip permanently. **Asset format (ADR-0013 §8):** ship the logo/icons as **SVG** (vector); raster assets as **WEBP**; a PNG/JPG product asset is an asset-hygiene defect, not an acceptable shortcut. **Exactly one logo per visible viewport** — desktop shows the brand-panel mark only; the mobile form-top logo is `lg:hidden` so the two never both render (the #237 duplicate-logo-on-desktop defect).
  - **On non-specific sign-off feedback** ("fix the details", no specifics): apply the polish candidates you have already self-identified and re-present ONE updated screenshot — do **not** re-query. Iterating obvious polish within the already-approved direction is the lead's call, not a new product question; re-asking the same question loses the turn.

A user-facing surface entering implementation with no recorded product-owner design sign-off is the banned shortcut — design/UX is not the lead's call.

## Output

- An explicit **adoption decision** cited in the first user-facing reply and the PR body: either `adopted <block> from <registry>` or `bespoke — toolbox search (shadcn/Origin/Intent·Jolly/Kibo) returned no fit because …`. This citation is the artifact that proves the gate ran.
- Adopted/bespoke code lives in `@ds/design-system`, re-skinned to tokens, live-verified.

## Failure modes

- **Hand-writing a scaffold without running step 3** (the #235 sin: a bespoke `AuthCard` while §3.1 said "adopt shadcn Blocks").
- **Committing proprietary-registry code into the public repo** (license violation — those are pattern-only).
- **Concluding the donor landscape from one link** — the gate names a fixed toolbox precisely so the search is complete, not anecdotal.
- **Entering a user-facing surface's implementation (In Progress / branch / UI code) with no product-owner design sign-off** — the design-approval gate (Stage A) is skipped; design/UX is a product decision, not the lead's taste.
- **Asking the user "is the dev box on?" instead of running `pnpm dev:status`** — the box is power-cycled; the live-verify pre-flight is the lead's to run (step 8).
- **Inverting the design gate** — running the engineering pipeline (live-verify / PR / Mode-a review / green CI) and surfacing the design to the product owner only at the end as a finished green PR. Design is approved _first_; a handoff-asserted "approved" is unverified.
- **Skipping the `frontend-design` pass / interaction-state audit** — shipping clickables with no hover feedback or an arrow cursor (no `cursor-pointer`), or never loading the `frontend-design` skill for a from-scratch surface.
- **Shipping a PNG/JPG product asset or a white-chip logo when a clean white/mono variant exists** — asset-hygiene defect (ADR-0013 §8): logos/icons are SVG, raster is WEBP, and a coloured surface uses the clean white/mono variant directly, not the colour logo on a chip.
- Declaring "done" on build/lint/review without a browser live-verify.
