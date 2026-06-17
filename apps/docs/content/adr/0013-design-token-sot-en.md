---
title: "ADR-0013 — Design-Token SoT, Theming & Block-Adoption Methodology for DS Platform [EN]"
description: "Tokens are the single source of truth (DTCG → Style Dictionary → Tailwind v4 @theme); UI is composed by adopting ready blocks from a fixed registry whitelist before any bespoke work; our product code is proprietary (UNLICENSED) at any repo visibility while third-party adoption is governed by the third party's license."
lang: en
---

> **EN-only** — tech ADR, no RU companion (design-system-foundation tech-spec §7).

# ADR-0013 — Design-Token SoT, Theming & Block-Adoption Methodology

**Date:** 2026-06-17
**Status:** Accepted
**Related to:** GitHub #231 (design-system foundation), #238 (methodology), #237 (auth slice)
**Brainstorm / design source:** [`specs/tech/2026-06-17-design-system-foundation-design-en.md`](../specs/tech/2026-06-17-design-system-foundation-design-en.md) (the full mechanics live there; this ADR is the decision record)
**Revises:** ADR-0004 §6.3 (the stale `tokens.json` → Tailwind-theme-config promise)
**Inherits:** ADR-0004 (frontend stack — Next.js + Tailwind v4 + shadcn/ui), ADR-0005 (RN+Expo mobile — phased token target), ADR-0008 (repo strategy — visibility & `UNLICENSED`), ADR-0001 §2 (custom inline forms over the BFF)

---

## Context

Feature 003 shipped a working auth UI, but the same class of UI papercuts kept recurring by hand (#192, #196, #197, #200, #211, #212, #227). Two root causes: (1) no single source of truth for design tokens — `globals.css` parameterised only radius + a neutral colour set; (2) no systematic reuse and no brand — screens were hand-assembled from primitives in the default shadcn skin.

#231 laid the token + component foundation. But the first component-layer pass (#235) still **hand-wrote** screen scaffolds (`AuthCard`) instead of **adopting** ready shadcn blocks as the spec prescribed, and a stale `@source` shipped an unstyled UI past build/lint/review. The lesson: adoption and token-discipline must be **gated mechanisms**, not good intentions. This ADR records the decisions; #238 institutionalises them as a skill + instructions.

---

## Decision

### 1. Tokens are the single source of truth (DTCG → Style Dictionary → Tailwind v4)

The SoT is `packages/design-system/tokens/*.json` in **DTCG** format, three tiers with references flowing only upward: **primitive** (raw values, never referenced by components) → **semantic** (meaning: `color.primary`, `radius.control`, `text.body`) → **component** (component-scoped). **Style Dictionary** compiles them to `src/styles/tokens.css` (a Tailwind v4 `@theme` block + `:root`/`.dark` CSS variables); every web app imports the generated CSS. This is **not** a hand-authored `tokens.json` nor a `tailwind.config` theme object. Mechanics: tech-spec §2.

### 2. Theming by semantic override

Components reference **only** semantic/component tokens — never primitives, never raw values. Light/dark and future themes/brands are expressed by overriding the **semantic** layer (`.dark` / `[data-theme]`); primitives are never duplicated per theme. Changing one semantic value re-themes the whole app — "change one radius, everything re-rounds". Multi-brand-ready without rewriting component classes.

### 3. Phased multi-platform target

The JSON source + Style Dictionary **web** emit are built now. A React-Native / native output target is a deferred, commented-out platform section, added when the mobile app starts (ADR-0005). The rework risk lives in token taxonomy/naming, not the emitter; authoring names DTCG-shaped from day one keeps the future mobile target mechanical. A `game.*` namespace is reserved for gamification (PRD §15); the game components themselves are out of scope.

### 4. Block-adoption methodology — research before bespoke

UI is composed by **adopting ready blocks/components before writing any bespoke UI**. This is a gated step, enforced by the `build-ui-from-design-system` skill (#238): frame the unit → inventory `@ds/design-system` → **search a fixed registry whitelist and report the result** → adopt → re-skin to tokens (owned code in `src/blocks`/`src/primitives`) → wire app glue in the app → live-verify → bespoke only after the search comes up empty (recorded).

**Approved registry whitelist (committable):** ① official **shadcn/ui** blocks + primitives (incl. `input-otp`), Radix variant · ② **Origin UI** · ③ **Intent UI / JollyUI** (React-Aria) · ④ **Kibo UI**. Acceptance bar for an adopted block: permissive license · correct RSC boundaries · accessibility · no superfluous dependencies · maintenance freshness.

### 5. Licensing model — proprietary product, license-governed adoption

Our product code is **proprietary**: `package.json` `license: UNLICENSED`, all rights reserved. **Repo visibility does not transfer any rights to our code** — we own it fully whether the repo is private or source-available/public (ADR-0008 §2.3: any opened state is _source-available_, not open-source). The licensing question concerns only **third-party code we adopt**:

- **MIT / permissive** (the whitelist above) — adopt freely into the proprietary product at any visibility; the only obligation is to preserve the upstream license/copyright notice. Including MIT-licensed owned-code does **not** make our product MIT.
- **Proprietary / paid** registries (shadcnblocks, Shadcn Studio, shadcn Pro) — usable only with a purchased license **and** only in a **private** repo; never committed to a public/source-available repo. While the repo is public they are **pattern-only**: study the UX, re-express it in permissive code.
- **Runtime UI-kits** (HeroUI, CoreUI, Syncfusion) — excluded regardless: a foreign runtime dependency breaks the owned-code model (architecture, not licensing).

### 6. Enforcement

Token discipline is enforced in CI (blocking) and pre-commit: `oxlint-tailwindcss` `no-hardcoded-colors`; stylelint `rhythmguard` scale discipline; a project ESLint rule forbidding arbitrary Tailwind values in `apps/*` and token redefinition outside `@ds/design-system`. The allowed-token list is derived from the Style Dictionary output, so styling and linting share one source. Mechanics: tech-spec §4.

---

## Rejected alternatives

- **Native Tailwind `@theme` only (no DTCG/Style Dictionary).** Sufficient for single-platform web, but DS Platform has RN+Expo on the roadmap (ADR-0005); the moment a native target or Figma sync must read the same values, a JSON token layer + compiler becomes the SoT. Authoring it now avoids a later rewrite.
- **A runtime UI-kit (MUI/Ant/HeroUI/…).** Foreign-kit bloat and opinion-fighting; contradicts the shadcn owned-code model. Rejected.
- **Bespoke-first, registries as occasional inspiration.** This is what produced the #235 regression. Adoption must be the gated default, not optional.
- **Go private to use a paid registry's code.** Unnecessary: the permissive whitelist fully covers current needs; visibility is an independent decision (ADR-0008), not a design-system driver.

---

## Consequences

- A semantic-token change re-themes the platform; the auth slice (#237) is the first reference build on the system.
- Future UI work composes from the system by default — the `build-ui-from-design-system` gate makes "don't reinvent" auditable (an adoption decision is cited in every UI PR).
- Our IP posture is explicit and visibility-independent; third-party adoption is license-checked at the gate.
- ADR-0004 §6.3 is revised to point here. The repo-visibility question (currently public; ADR-0008 §2.1 target is private until Pre-pilot) is tracked under ADR-0008, not here.
