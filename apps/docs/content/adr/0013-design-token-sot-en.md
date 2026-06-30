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

The auth slice (#237) then surfaced a third recurring class the same way: **interaction-state defects** — clickables with no `cursor-pointer`, no hover/active feedback, no `prefers-reduced-motion` handling (Tailwind v4 Preflight dropped the v3 `button { cursor: pointer }` reset, so every shadcn primitive scaffolded under v3 assumptions silently degrades) — and **asset-format debt** (a heavy PNG wordmark, a white-chip workaround for a white logo that already existed). These are systemic, not per-screen; §7 and §8 make interaction-state quality and asset hygiene guaranteed-by-default and enforced, the same way §4/§6 made adoption and token discipline gated rather than optional.

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

### 7. Interaction-state & motion quality contract

Every interactive element carries its full state set as a **contract**, not as the diligence of a page author: **default / hover / active / focus-visible / disabled / loading**, and respects `prefers-reduced-motion`. A clickable with an arrow cursor, no hover feedback, or no visible keyboard-focus ring is a **defect**, not a pass.

Quality is guaranteed by a **layered defence**, each layer making the next cheaper and catching what the prior misses:

1. **Global base-reset** (`globals.css @layer base`) — restore `cursor: pointer` for enabled interactive elements / `not-allowed` for `:disabled`, and a `prefers-reduced-motion` guard. One place, covers every element including future and third-party components (the "by default" layer; it fixes the Tailwind-v4 Preflight regression at the root).
2. **Primitive state contract** — each interactive primitive declares the full state set via a shared `interactiveBase` fragment (token-only): hover, `active:` press, focus-visible, disabled, loading (`aria-busy`).
3. **Static lint guard** — a CI rule (`interaction-states`, #269) checks two things: the layer-1 base-reset stays intact in `globals.css` (the `cursor` resets + the `prefers-reduced-motion` guard), and every styled clickable primitive (`button` / `[role="button"]` / Radix `*.Trigger`) declares a `hover:` affordance and a `focus-visible:` ring (the latter directly or via the shared `interactiveBase` fragment). Cursor is owned globally by layer 1, so it is asserted there, not re-checked per primitive (WARN in Phase 0 per ADR-0007 §2.6, promoted to BLOCK once stable).
4. **Runtime verification** — Playwright interaction smoke (computed `cursor:pointer`, hover style delta, focus ring) + axe-core a11y scan (contrast / focus) in CI, **retargeted onto the living showcase** so the checks span the whole catalogue, not just the auth surfaces; Storybook visual-regression stays deferred (tech-spec §3.2).
5. **Process gate** — the `build-ui-from-design-system` skill mandates a `frontend-design` pass + an interaction-state audit in live-verify, so the human-in-the-loop check references the automation rather than replacing it.

**Rendered SSOT surface.** This whole contract is rendered and machine-checked in one place — the **living showcase** (`apps/showcase`, `@ds/design-system`'s rendered viewer): every primitive and block in every state, on a live URL on the dev stand, kept honest by a coverage guard and the retargeted Playwright+axe checks above. It is the surface a coding agent consults for the look and the product owner approves for the design system as a unit (Stage A/B). Design: [design-system-showcase](../specs/tech/2026-06-29-design-system-showcase-design-en.md).

The a11y-contrast usage rule is part of this contract: white text on the brand-pinned `primary` / `success` / `warning` fills is allowed **only at large/bold** (≥3:1); normal-weight text on a colour fill uses the darker `blue.700` (`#114D9E` = Pantone Dark Blue C, a registered brand anchor; white 8.14:1). The filled primary `Button` realises this as the accessible action-fill triad `primary-action` (blue.700, resting) → `primary-hover` / `primary-pressed` (blue.800, 11.12:1). The same rule applies to **coloured text on a light surface**: link text uses `primary-action` (blue.700, 8.14:1 on white), since `primary` (blue.500) text is only ~3.3:1 and fails AA. `primary` = blue.500 stays the brand anchor for the **focus ring, icons and tints** (graphical / large-element uses where the 3:1 non-text threshold applies), not for normal-weight text. Layer 4's axe scan is the machine check for it. Mechanics: tech-spec.

#### Form layout & validation contract

The auth surfaces (#322, redone in #333) surfaced **form rhythm and validation messaging** assembled per-screen. The slice-B round shipped a _reserved one-line slot under every validating field_ to kill reflow-on-error, but a live product-owner review found it produced the opposite defect — a permanent blank line that **over-spaced** every form (K-1) and a message that read as glued to the _next_ field — alongside an error treatment where label + helper + message all turned red ("red mush", K-3) and a segmented control whose segments **glued on hover** (K-2). The #333 redo settled the standard the right way: web best-practice research (NN/g, Baymard, GOV.UK, GitHub Primer, Shopify Polaris) + **rendered** options presented to the product owner, who picked explicitly. Concrete classes live in the design-system README (`Form layout standard`); the contract + rationale + citations are here.

**Inline validation message (no reserved line).** The message renders **on demand** directly under its control — the field's helper (muted) by default, **swapping the error into its place** on validation failure; a field with neither helper nor error renders **nothing** (no reserved blank line). This is the Polaris / Primer / shadcn / Radix default and the fix for the slice-B over-spacing (K-1): the canonical no-reflow mechanism is the error **replacing the helper text in the same position**, not a permanent blank line stacked over every field ([NN/g](https://www.nngroup.com/articles/errors-forms-design-guidelines/), [Material errors](https://m1.material.io/patterns/errors.html)). The accepted cost is a small one-line downward shift when an error appears; validation fires **on blur** (`mode: onTouched`), never mid-typing, so the shift is rare and expected ([Baymard](https://baymard.com/blog/inline-form-validation)). The message text is **small (`text-xs` = 12 px) and not bold** — the slice-B bold `text-sm` read "heavy" (owner finding).

**Error summary for long forms (>3 fields).** A form with **more than 3 fields** instead collects its errors into one **summary panel placed below the submit button** (focus moves to it on submit) plus the per-field red borders — the GOV.UK / Primer pattern for longer forms ([GOV.UK error-summary](https://design-system.service.gov.uk/components/error-summary/), [Primer forms](https://primer.style/product/ui-patterns/forms/)). All current auth forms are ≤3 fields → inline; the `<FormErrorSummary>` primitive is **deferred** to the first >3-field form (tracked) to avoid shipping an unused component.

**Error colour scope (mark the field, not the text).** Invalidity is carried by the **input border + a destructive focus ring + the message** — the **label stays neutral** (K-3). A red label stacked on a red helper and a red message is the "red mush" the owner flagged; best practice marks the field itself, with colour **plus** text (and an icon for the summary), never colour alone ([NN/g](https://www.nngroup.com/articles/errors-forms-design-guidelines/)). The input reads its `aria-invalid` (set by `FormControl`) → `aria-invalid:border-destructive` + `aria-invalid:focus-visible:ring-destructive`.

**Vertical rhythm.** Label↔control gap stays **tight but ring-clearing** (`gap-2.5` = 10 px on a `flex flex-col` `FormItem`) — the focus ring (`interactiveBase` `ring-2 ring-offset-2`) extends ~4 px above the input, so a 6–8 px gap leaves it touching the label (live-proven #227/#267). Field-group separation is `space-y-4` (16 px) on the form's field wrapper — **larger** than the in-field 10 px so an on-demand message reads as belonging to **its** field, clearly closer to it than to the next field's label (proximity / Gestalt — the slice-B "message glued to the next label" defect, #333 owner finding). With no reserved slot the resting form is tight; 16 px between fields keeps distinct fields distinct without the slice-B over-spacing. **No "ноготь":** no doubled error outline (a border _and_ a ring together at rest) and no thick coloured accent stripe (e.g. `border-l-4`) on panels — rest carries a single clean border, the ring appears only on focus.

**Enforcement (style owned in one place).** The error look — `role="alert"` + the destructive text token — is owned **once** by the `FormError` / `FormMessage` primitive; the #333 review found it had been re-typed as a raw `<p role="alert" className="text-xs text-destructive">` on 6 pages + a block, invisible to every existing guard (`text-destructive` is a valid token, so the colour / arbitrary-value guards pass). A static lint guard (`form-error`, #339) closes that gap: it flags any app-source opening tag carrying **both** `role="alert"` and a `text-destructive` token (the duplication signal) and requires it route through the primitive instead, with a reasoned `/* form-error-ok: <reason> */` opt-out for genuine exceptions. WARN in Phase 0 (ADR-0007 §2.6), promoted to BLOCK once stable; same shape as the `interaction-states` guard and the `form-rhythm` guard (#334). Fixture-tested in `@ds/lint-guard-tests`.

The companion **`form-rhythm` guard (#334)** statically enforces the three other defects the #333 owner review caught — each a _valid_ token combination that the colour / arbitrary-value / `interaction-states` / `form-error` gates all miss: a `min-h-*` **reserved blank line on a message** element (K-1 over-spacing — the message reserves no height), a **duplicate `formDescriptionId`** (a `<FormDescription>` rendered beside a `<FormMessage>`, which both claim the id in the resting state — the PasswordField bug), and a **`text-destructive` label** in the error state (K-3 "red mush" — the label stays neutral). It scans the DS form primitives _and_ the app form surfaces, with the same `/* form-rhythm-ok: <reason> */` opt-out; WARN in Phase 0, fixture-tested in `@ds/lint-guard-tests`. `form.test.tsx` already pins K-1/K-3 at runtime; this guard is the static, no-React regression net.

#### Async-submit pending standard

A live product-owner review of the auth surfaces (#337, from the #333 Stage-B round) found a `loading`-state gap that is the motion twin of the form-layout defects above: on submit the surface **appeared to hang** — the submit button only flipped to a static `disabled={isSubmitting}` with no motion, so the user got **no progress signal** on the network round-trip (login / register / OTP-request / verify / reset all shared it). A static disabled control is indistinguishable from a dead one.

The state itself was never the gap — the `Button` `loading` prop (layer 2, #273) already renders a determinate spinner, sets `aria-busy`, **disables the control while busy** (so it doubles as the double-submit guard), and is neutralised under `prefers-reduced-motion` by the layer-1 base-reset (the spin stops; `aria-busy` still announces). The gap was **adoption**: pages wired `disabled={isSubmitting}` instead of `loading={isSubmitting}`. The settled standard, owned here and not left to per-page diligence:

**Every async submit drives the pending affordance from its in-flight flag — `loading={isSubmitting}`, never a bare `disabled={isSubmitting}`.** A control whose `onSubmit` awaits a network call is "async"; `Button.loading` already disables while busy, so `loading` is strictly the richer wiring (spinner + `aria-busy` + the same inert/disabled behaviour). This covers every auth submit and the shared `<OtpFocusScreen>` block (which drives it from the app-owned `isSubmitting`). Cooldown/validity-gated `type="button"` controls (resend, change-method) keep their `disabled` — they are not async submits.

**Enforcement.** The `submit-pending` guard (#337) statically flags a `type="submit"` control disabled by an in-flight flag (`isSubmitting` / `isLoading` / `isPending` / `inFlight`) that carries no `loading` prop — the exact valid-token combo the colour / `interaction-states` / `form-*` gates all pass (`disabled` is a fine prop; the omission of `loading` is the bug). It scans the DS blocks/primitives + the app form surfaces, with a reasoned `/* submit-pending-ok: <reason> */` opt-out; WARN in Phase 0 (ADR-0007 §2.6), promoted to BLOCK once stable; same shape as `form-error` / `form-rhythm`, fixture-tested in `@ds/lint-guard-tests`. Concrete usage lives in the design-system README (`Async-submit pending`).

**Enforcement.** The `showcase-snippet` guard (#396) keeps the living showcase a true viewer that **re-implements nothing** ([design-system-showcase](../specs/tech/2026-06-29-design-system-showcase-design-en.md) §2.4): it statically flags a `apps/showcase/**` string/template-literal constant whose VALUE depicts block/component usage — a `from "@ds/design-system…"` import line or a PascalCase JSX opening tag (`<AuthCard …>`) typed INSIDE the literal. Such a hand-typed snippet is a second, hand-maintained copy of code the package already owns, and it DRIFTS the moment the package evolves; mature systems (shadcn Blocks, Storybook autodocs) **auto-extract** displayed code from the real source so the shown code is the run code and cannot drift, so the rule is "if a usage snippet is wanted, auto-extract it from the real example file, never type it". The guard inspects only literal BODIES (a char-walk that skips comments and surrounding code), so a real top-of-file import and real rendered JSX stay green; reasoned `/* showcase-snippet-ok: <reason> */` opt-out; WARN in Phase 0 (ADR-0007 §2.6), promoted to BLOCK once stable; same shape as `showcase-coverage` / `submit-pending`, fixture-tested in `@ds/lint-guard-tests`.

#### Per-clickable interaction-state matrix

Every clickable kind declares its full resting→hover→active→focus→disabled set as a contract (layer 2). This matrix is the authored standard the primitives implement against; it resolves the auth-slice defects #2 (disabled vs secondary), #3 (link state), #4 (tab inset). Token-only throughout; concrete classes in the README.

| Kind                           | Resting                                                    | Hover                                                       | Active                            | Disabled                                                       |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `default` (primary)            | `primary-action` fill + `shadow`                           | `primary-hover` fill                                        | `primary-pressed` fill            | `opacity-50` + `pointer-events-none` + L1 `cursor-not-allowed` |
| `secondary`                    | `secondary` fill **+ `border border-input`** + `shadow-sm` | `border-ring` + `secondary/70` fill                         | `secondary/60` fill               | same disabled treatment                                        |
| `outline`                      | `border border-input` + `bg-background` + `shadow-sm`      | `accent` fill                                               | `accent/80` fill                  | same                                                           |
| `ghost`                        | transparent                                                | `accent` fill                                               | `accent/80` fill                  | same                                                           |
| `link` (button) / `Link` (nav) | `text-primary-action` (blue.700, AA), no resting underline | **`underline`** (`underline-offset-4`)                      | `text-primary-action/80`          | `opacity-50` + L1 `cursor-not-allowed`                         |
| tab (`TabsTrigger`)            | inactive `text-foreground/60`, list **`gap-2` track**      | inactive `hover:text-foreground` + `hover:bg-background/50` | active `bg-background` + `shadow` | `opacity-50`                                                   |

**#2 — disabled vs secondary.** The defect: `secondary` (a near-white `bg-secondary` fill) and a `disabled:opacity-50` element are _both_ low-presence, so an enabled secondary "looks disabled". The fix is not a darker fill (that fights the muted intent) but a **structural enabled-cue** — secondary gains `border border-input` so it reads as a deliberate bordered clickable control (the shadcn/ui v4 `outline` variant uses exactly a border to signal an enabled-but-quiet action). **Disabled is then defined by the _combination_** of `opacity-50` **and** the L1 `cursor: not-allowed` + `pointer-events-none`: disabled is unambiguous because it is dimmed _and_ inert _and_ shows the not-allowed cursor — none of which a resting secondary has (bordered, pointer cursor, live hover). The disabled visual contract is "dimmed + not-allowed cursor + inert"; secondary is "bordered + pointer + hover response".

**#3 — link state.** Portal nav/footer links are currently raw `<Link className="underline">` with no hover, focus, or disabled treatment. The new `Link` primitive (#324) implements the `link` row: `text-primary-action` with **no resting underline**, `hover:underline`, a `focus-visible` ring via `interactiveBase`, and `active:text-primary-action/80`. Link text uses **`primary-action` (blue.700, `#114D9E`)**, not `primary` (blue.500): blue.500 on white is only ~3.3:1 and **fails WCAG AA** for normal-weight text (the layer-4 axe scan flags it), whereas blue.700 is 8.14:1. Rationale (NN/g + WCAG link-state guidance): a link must stay visibly a link and change clearly on hover _and_ focus, and must not rely on colour alone — persistent brand colour + hover-underline + a keyboard focus ring identical to the hover affordance (WAI consistency) satisfies this. A link inside body copy keeps a resting underline; a standalone nav link relies on colour + hover-underline + focus ring.

**#4 — segment separation (K-2, redone in #333).** The slice-B `border border-transparent` only stopped the active tab's shadow from shifting its neighbour; it did nothing for _visual_ separation, so on **hover** an inactive segment's `hover:bg-background/50` butted flush against the active segment and the two read as one glued block (owner finding). The fix is a **visible track gap** — `gap-2` on `TabsList` opens space between segments so a hover fill never reaches the active segment. (Researched: a segmented control's items are connected by a track, and separating them tips it toward _tabs_; since each segment here shows a different form it is arguably tabs already — [Primer](https://primer.style/components/segmented-control), [Component Gallery](https://component.gallery/components/segmented-control/). The owner picked the gap-pills treatment over an underline-tabs restyle.) Inactive `text-foreground/60` → `hover:text-foreground`, active `bg-background` + `shadow`.

### 8. Asset-format policy

Product assets are **vector-first**: logos and icons ship as **SVG** (lightweight, resolution-independent, version-controllable, themeable via `currentColor`). Raster assets (photography, screenshots) ship as **WEBP** at minimum. **PNG / JPG are disallowed** for product assets — a PNG wordmark or a raster icon is an asset-hygiene defect, not an acceptable shortcut.

A coloured surface uses the **clean white or mono brand variant directly**; a CSS colour-inversion filter or a `bg-card` token chip standing in for a missing variant is a workaround, not a treatment — confirm the variant's absence by opening the brandbook before reaching for a fallback, and if it is genuinely absent, request it rather than shipping the hack. Enforcement: an optional CI guard flagging committed `*.png` / `*.jpg` under `apps/*/public` and the design system (tech-spec).

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
- Interaction-state quality and asset hygiene are guaranteed-by-default and enforced (§7–§8) rather than left to per-screen diligence; the #237 auth slice is re-applied on this hardened foundation as the proof (#270 epic).
- ADR-0004 §6.3 is revised to point here. The repo-visibility question (currently public; ADR-0008 §2.1 target is private until Pre-pilot) is tracked under ADR-0008, not here.
