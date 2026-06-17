---
title: "build-ui-from-design-system"
description: "Procedural skill (inline): before building ANY UI (page/form/element), run the registry-research gate over the approved MIT toolbox; adopt + re-skin to tokens; bespoke only after the search comes up empty."
name: build-ui-from-design-system
mode: inline
---

# build-ui-from-design-system

**Kind:** procedural · **Mode:** inline (the lead agent executes this procedure itself).

The design system exists so we **do not reinvent the wheel**. This skill makes adoption a _gated step_, not a good intention: every UI-shaped task passes the registry-research gate before any bespoke code is written. Canon: **ADR-0013** (design-token SoT, block adoption, the approved toolbox, the public-repo MIT constraint) and ADR-0004 §6 (frontend stack).

## When this applies

Any task that creates or reshapes an interface: a page, a form, a single field/control, a layout, an overlay, an empty/error/loading state. If the user can see it, this gate applies.

## Input

- A UI-shaped task (feature-spec surface, an Issue, or a plain description) and its target app (`apps/portal` / `admin` / `cms` / `promo`).

## Procedure

1. **Frame the unit.** Name the UI unit and enumerate its states (default / filled / invalid / loading / empty / error / disabled). You adopt against the _states_, not a happy-path screenshot.
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
8. **Live-verify.** Bring up the dev-stand + the app and drive the journey in a browser (Playwright) — mandatory per CLAUDE.md "UI verification". typecheck/build/lint/Mode-a review are necessary but not sufficient.
9. **Bespoke is the last resort.** Build from scratch only after step 3 comes up empty, and **record the negative search result** (which registries, which candidates rejected and why) in the PR/spec so the decision is auditable.

## Output

- An explicit **adoption decision** cited in the first user-facing reply and the PR body: either `adopted <block> from <registry>` or `bespoke — toolbox search (shadcn/Origin/Intent·Jolly/Kibo) returned no fit because …`. This citation is the artifact that proves the gate ran.
- Adopted/bespoke code lives in `@ds/design-system`, re-skinned to tokens, live-verified.

## Failure modes

- **Hand-writing a scaffold without running step 3** (the #235 sin: a bespoke `AuthCard` while §3.1 said "adopt shadcn Blocks").
- **Committing proprietary-registry code into the public repo** (license violation — those are pattern-only).
- **Concluding the donor landscape from one link** — the gate names a fixed toolbox precisely so the search is complete, not anecdotal.
- Declaring "done" on build/lint/review without a browser live-verify.
