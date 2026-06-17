---
title: "DS Platform — Design-System Foundation (Design)"
description: "Token-driven design system as the single source of truth: DTCG token layer (primitive → semantic → component) compiled by Style Dictionary to Tailwind v4 @theme/CSS-vars (web now, RN deferred); owned-code block reuse from the shadcn ecosystem; lint guardrails; auth as the first vertical migration absorbing #227; methodology/docs/ADR alignment."
slug: design-system-foundation
status: In design
tracker: https://github.com/doctor-school/ds-platform/issues/231
lang: en
---

# DS Platform — Design-System Foundation (Design)

**Date:** 2026-06-17
**Status:** In design (brainstorm output of #231 — spec → ADR-0013 + ADR-0004 revision → implementation)
**Type:** Platform-level frontend foundation design.
**Applies (not inherits):** ADR-0004 (frontend stack — Next.js + Tailwind v4 + shadcn/ui, 4 web apps), ADR-0005 (RN+Expo mobile), ADR-0001 (custom inline forms over the BFF — §2), 003-design §8 (auth UI model + i18n + field primitives)

---

## 1. Context & problem

Feature 003 shipped a working auth UI, but the same class of UI papercuts keeps recurring by hand (#192, #196, #197, #200, #211, #212, #227). Two root causes:

1. **No single source of truth for design tokens.** `packages/design-system/src/styles/globals.css` is the de-facto token file, but it only parameterises `--radius` and a neutral (un-branded) color set. Typography, spacing scale, shadow/elevation, motion, z-index, opacity are not tokenised. Changing brand styling means touching many spots — the opposite of "one orchestra".
2. **No systematic reuse and no brand.** Auth screens are hand-assembled from primitives in `apps/portal`, in the default neutral shadcn skin; the field primitives (#197) and the OTP-flow logic live in the app, not the shared package, so portal/admin/cms cannot reuse them. The Doctor.School brand is not applied.

This is the moment to lay the foundation correctly — before the platform grows from one feature (auth) toward the multi-app, multi-role, gamified, multi-generation surface the ADRs describe (ADR-0004 §3–§7: promo/portal/admin/cms + 4 portal cabinets; ADR-0005 RN+Expo mobile; PRD §15 gamification).

**Decided / out of scope (not re-litigated):** custom inline forms over the BFF stay (ADR-0001 §2, 003-design §8). This is NOT about Zitadel Login V2 or swapping the IdP. The question is purely _how_ we build our own custom UI: token-driven, reusing owned-code blocks, brand-applied, self-policing.

### 1.1. Research basis (best-practice grounding)

The decisions below are grounded in a June-2026 review of current best practice (sources in §10):

- **Token SoT** — mature teams use a three-tier token taxonomy (primitive → semantic → component) exposed to web through Tailwind v4 `@theme`/CSS variables; a single semantic change propagates app-wide.
- **Multi-platform criterion** — single-platform web is well served by native Tailwind `@theme` alone; **the moment a native mobile app, a partner brand, or a Figma sync must read the same values, a JSON token layer (DTCG) + a compiler (Style Dictionary) becomes the source of truth above Tailwind.** DS Platform has RN+Expo mobile on its roadmap (ADR-0005) → this criterion applies.
- **Reuse** — the shadcn model is _copy-in owned code_ (registry CLI), not a runtime UI-kit dependency, so the "dead-weight from a foreign kit" concern (MUI/Ant-class bloat) does not apply: only the chosen blocks are installed, become owned source, are tree-shaken and re-skinned via tokens. Reuse at the **block/section level** (whole auth screens) is the established practice.
- **Enforcement** — token discipline is enforceable in CI and at edit time (e.g. `oxlint-tailwindcss` `no-hardcoded-colors`; stylelint `rhythmguard` for scale discipline), which is how a design system becomes self-policing.

---

## 2. Token architecture & pipeline

### 2.1. Source of truth — DTCG token files

The single source of truth is `packages/design-system/tokens/*.json` in **DTCG** (Design Tokens Community Group) format, in three layers with references flowing only "upward":

```
tokens/
├── primitive.json   # raw values: color.blue.500, space.4, font.size.300 — NEVER referenced in components
├── semantic.json    # meaning: color.primary → {color.blue.500}, radius.control, text.body
└── component.json    # component-scoped: button.radius → {radius.control}, otp-slot.size
```

**Token classes (full set, not just color+radius):** color, typography (family / size / weight / line-height / letter-spacing), spacing scale, radius, border-width, shadow/elevation, motion (duration / easing), z-index, opacity, breakpoints.

A reserved `game.*` namespace is allocated in the taxonomy for future gamification (PRD §15: mascot, Lottie/Rive, Con/Pul/Au cards); the game components themselves are out of scope for this foundation.

### 2.2. Compilation — Style Dictionary → Tailwind v4

Style Dictionary reads `tokens/*.json` and emits `packages/design-system/src/styles/tokens.css` — a Tailwind v4 `@theme` block plus `:root` / `.dark` CSS custom properties. Every web app imports this generated CSS (as the apps import `globals.css` today). Token-build is a CI step; it also validates that references resolve and produces the allowed-token list consumed by the lint guardrails (§4).

**Phasing (decision — "Phased-with-JSON"):** the JSON source + Style Dictionary web emit are built **now**. A React-Native / native output target is a commented-out placeholder platform section, added when the mobile app actually starts (ADR-0005) — that is a "add a platform target" change, not a token rewrite. The rework risk lives in token taxonomy and naming, not in the emitter; authoring the names DTCG-shaped from day one keeps the future mobile target mechanical.

### 2.3. Theming — "change one radius, everything re-rounds"

Components reference **only** semantic/component tokens, never primitives and never raw values. Changing `radius.control` in `semantic.json` → token-build → the whole app re-rounds. Light/dark and future themes/brands are expressed by overriding the **semantic** layer (`.dark` / `[data-theme="…"]`); primitives are never duplicated per theme. This is multi-brand-ready without rewriting component classes.

### 2.4. Fixes the ADR-0004 §6.3 drift

ADR-0004 §6.3 promises tokens in `packages/design-system/tokens.json` → Tailwind theme config. That file never materialised; reality is a hand-authored `globals.css` with radius+color only. This section makes the ADR's promise real and corrects the mechanism (DTCG + Style Dictionary + `@theme`, not a `tailwind.config` theme object).

---

## 3. Component layering & `@ds/design-system` structure

```
@ds/design-system/
├── tokens/              # §2 — DTCG source of truth
├── src/styles/          # generated tokens.css + base layer
├── src/primitives/      # owned shadcn components (button, input, card, form, input-otp, tabs, + new)
├── src/blocks/          # composed patterns: AuthCard, OtpFocusScreen (#227), form scaffolds
└── src/index.ts
```

**Dependency flow (strictly downward):** `tokens → primitives → blocks → (app glue in apps/*)`. An app **never** overrides a token and **never** hardcodes a style — it only consumes.

**Key move:** the field primitives (#197) and the shared auth logic **move from `apps/portal/components` into `@ds/design-system`**, so portal/admin/cms can all reuse them (every app will have auth). App-specific glue (BFF calls, EARS-16 generic errors, routing, i18n wiring) stays in the apps.

### 3.1. Block adoption (the reuse strategy)

Reuse happens at the **block/section level** — whole auth screens, not just buttons. Process:

1. Source a block from the shadcn ecosystem — official **shadcn Blocks** (sign-in / sign-up / forgot-password / OTP / MFA, MIT) as the primary donor; community registries (shadcnblocks, Shadcn Studio) as pattern donors (e.g. OTP-with-resend, recovery codes). All are copy-in owned code via registry CLI.
2. Install → re-skin to **our** tokens (so the token system must exist first) → place in `src/blocks/` as owned source.
3. **Acceptance bar** (not all registries are production-grade): MIT/compatible license; correct RSC boundaries (`"use client"` only where required); accessibility; no superfluous dependencies; maintenance freshness.
4. App-specific glue is never inside the block: the block is the screen scaffold; the BFF endpoints, EARS-16 generic errors, #197 field primitives, auto-submit, masked-destination + resend/cooldown (#227) are wired in the app/composition layer.

### 3.2. Storybook — deferred (conscious)

No Storybook in this iteration (ADR-0004 OQ-F9 trigger: ≥2 frontend developers / >20 components). Live verification is browser-on-stand per CLAUDE.md "UI verification (mandatory)". Recorded as a deliberate deferral, not a gap.

---

## 4. Enforcement — lint guardrails

The system must warn the developer at edit time and block in CI when code bypasses the design system. Three levels:

1. **`oxlint-tailwindcss`** (Tailwind-v4-native) — `no-hardcoded-colors`: forbids `bg-[#ff5733]` and arbitrary colors outside tokens.
2. **stylelint + `rhythmguard`** — scale discipline: flags `p-[13px]`, `gap-[18px]`, arbitrary radius/typography/motion and autofixes to the nearest scale token.
3. **Project ESLint rule** (in the spirit of the existing `no-class-validator` / `no-vercel-only-api`): forbid arbitrary Tailwind values in `apps/*` and forbid token redefinition outside `@ds/design-system`.

**Single source for checks too:** the allowed-token list is derived from the Style Dictionary output (§2.2), so styling and linting share one source of truth. **Gates:** rules run in CI (blocking) and pre-commit (fast feedback).

---

## 5. Auth as the first vertical slice (the reference)

The first functional module is rebuilt "the right way" and becomes the reference for all future UI:

- `login` / `register` / `verify` / `reset` (`apps/portal`) are rebuilt on **tokens + blocks from `@ds/design-system`**, with the brand applied.
- **#227 is closed here:** `OtpFocusScreen` — a reusable component (masked destination + resend/cooldown + auto-submit), not ad-hoc. It retires the papercut class (#192/#196/#200/#211/#212) via one component rather than point fixes.
- App glue (BFF `/v1/auth/*`, EARS-16 generic errors, localization) is preserved — only the presentation layer changes.
- **Mandatory live verification** (CLAUDE.md): bring up the dev-stand + portal, drive every journey in a browser (Playwright), confirm the rendered result and the brand. typecheck/build/lint/Mode-a review are necessary but not sufficient.

**Slice DoD:** auth works end-to-end in a browser on the new system with the brand applied — this is the reference the rest of the platform builds from.

---

## 6. Brand integration (brand → token map)

- The Doctor.School brand book (to be added to the repo by the user) maps into the **primitive + semantic** layers: palette → `color.*`; fonts → `font.family.*`; radii/shadows/spacing/motion → the corresponding scales; logo/mascot → asset tokens/components.
- Deliverable: the **brand → token map** — authored in [`2026-06-17-design-system-foundation-brand-token-map.md`](./2026-06-17-design-system-foundation-brand-token-map.md). The Doctor School brand book is in the repo (`apps/docs/brandbook/`); the map pins the brand-defined values (primary blue `#2D84F2` + dark/light blues; Inter as the UI base font; brand green/orange for success/warning; reserved accent palettes and display fonts) and marks the brand-unspecified classes (neutral ramp, type scale, radius, spacing, shadow, motion) as `system`-derived. Decisions captured: destructive uses an **introduced** functional red (the brand has none); the additional accent palettes are **reserved** in the primitive layer (no semantic role) until category/gamification surfaces arrive.
- Gamification (PRD §15) sits as a layer **on top of** the shadcn shell; the foundation reserves the `game.*` token namespace but the game components themselves are out of this iteration's scope.

---

## 7. Methodology / docs / instructions / ADR / memory alignment

So that future UI work composes from the system by default:

**ADRs:**

- **New ADR-0013 "Design-token SoT & theming"** — records: DTCG source + Style Dictionary, three-tier taxonomy, phased RN target, theming, enforcement. Narrative+design pair per the ADR convention, EN-only (tech).
- **ADR-0004 §6.3 revision** — replace the stale `tokens.json`/`tailwind.config` promise with reality (DTCG + Style Dictionary + `@theme`); add a section on the block-adoption strategy (registry CLI, owned code, acceptance bar) and on the `@ds/design-system` layering.

**Skills catalog (`apps/docs/content/skills/`):**

- **New skill `build-ui-from-design-system`** — workflow: a UI task → pick tokens/primitives → check the registry for a ready block before writing from scratch → re-skin with tokens → app glue → live verification. Institutionalises "don't reinvent" as a procedure.

**Instructions:**

- **CLAUDE.md / AGENTS.md** — short rules: UI is built from `@ds/design-system`; styling only via tokens; arbitrary values forbidden (lint); a ready block is checked before bespoke. Reference ADR-0013 as canon.

**Memory:** record feedback facts — "design-system as SoT via tokens", "ready blocks before bespoke", "tokens are the only styling mechanism" — so they apply across future sessions.

---

## 8. Migration plan / decomposition

**Artifacts of this track (output of #231):**

1. This tech-spec — in `apps/docs/content/specs/tech/`.
2. ADR-0013 (new) + ADR-0004 revision.
3. Brand → token table.
4. Auth-surface migration plan (absorbs #227).
5. The methodology/docs/instruction update list.

**Implementation sequence (after spec approval), each a GitHub Issue, `blocked_by` the prior where noted:**

1. **Token foundation** — `tokens/*.json` (DTCG) + Style Dictionary + generated `tokens.css` (full token-class set). _Blocks everything else._
2. **Lint guardrails** — oxlint-tailwindcss + rhythmguard + project ESLint rule + CI/pre-commit gates. _blocked_by 1 (consumes the allowed-token list)._
3. **Component layer** — move field primitives (#197) + auth-shared into `@ds/design-system`; adopt the base shadcn auth blocks; `OtpFocusScreen` (#227). _blocked_by 1._
4. **Brand** — apply brand-book values to the tokens (once the book is added). _blocked_by 1; parallel to 2–3._
5. **Auth slice** — rebuild `login/register/verify/reset` + live browser verification. _blocked_by 3 (and 4 for final brand)._ #227 is re-pointed here as absorbed.
6. **Methodology** — ADR-0013 / ADR-0004 revision, new skill, CLAUDE.md/AGENTS.md, memory. _parallel; lands with/after 5._

Dev work is orchestrated via Opus subagents per the project catalog (not inline). Implementation follows once this spec is approved.

---

## 9. Non-goals

- NOT adopting Zitadel Login V2 / NOT changing the IdP (custom inline forms over the BFF stay — ADR-0001 §2).
- NOT building gamification components (PRD §15) — only reserving the `game.*` token namespace.
- NOT introducing Storybook (ADR-0004 OQ-F9 not yet triggered).
- NOT migrating non-auth portal surfaces or admin/cms in this iteration — auth is the first vertical slice; the rest follow as separate tasks on the same foundation.
- NOT wiring the RN/native token target — deferred until the mobile app starts (ADR-0005).

---

## 10. Sources (research, June 2026)

- Design tokens / Tailwind v4 layering: maviklabs.com/blog/design-tokens-tailwind-v4-2026; clearly.design/articles/ai-ready-ds-4-design-tokens-tailwind-v4; shadisbaih.medium.com (scalable design system with shadcn + Tailwind + tokens).
- DTCG / Style Dictionary vs native `@theme` (multi-platform criterion): github.com/tokens-studio/sd-tailwindv4; v4.styledictionary.com/reference/utils/dtcg; adamarant.com/en/blog/design-tokens-vs-css-variables-vs-tailwind.
- shadcn theming / registry / blocks: ui.shadcn.com/docs/theming; ui.shadcn.com/docs/registry/registry-item-json; tweakcn.com; registry.directory.
- Block ecosystem: shadcnblocks.com (input-otp / auth); shadcnstudio.com/blocks (two-factor-authentication); Origin UI / COSS.
- Enforcement: earezki.com / sergioazocar.com (oxlint-tailwindcss); npmjs.com/package/stylelint-plugin-rhythmguard; michaelmang.dev/blog/linting-design-tokens-with-stylelint.
