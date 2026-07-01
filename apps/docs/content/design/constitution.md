---
title: "Design Constitution"
description: "The per-element-class store of researched UI standards — one accumulating section per element class, filled by research-ui-element and consulted before any UI is built. A covered class is reused, not re-researched."
---

# Design Constitution

The **living store of per-element-class UI standards**. Each element class we build (button, field, error display, tabs …) gets **one section here**, written once from real best-practice research and then **reused, not re-researched**. This is the surface a coding agent consults for _what the standard is_ and the product owner approves options against (Stage A of the design-approval gate).

It closes the epic-#340 root cause that _research was ephemeral and "performed-not-real"_: research was done in-head or cited-without-showing, then thrown away after the PR, so the next surface re-derived it wrong. Here it is **durable and additive**.

## The three linked surfaces (no duplication)

This store holds the **research** — the _why_, the citations, the option history. It does **not** re-host the decision record or the concrete classes; each lives in exactly one place and this store links to it:

| Surface                               | Holds                                                                                                                  | Where                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Design Constitution** (this doc)    | Per-class **research**: best-practice principle, citations, rendered-option history, token/primitive mapping           | here                                                                            |
| **ADR-0013 §7**                       | The **decision**: the layered-defence model, the interaction-state contract principle, the enforcement/guard catalogue | [`adr/0013`](../adr/0013-design-token-sot-en.md)                                |
| **`@ds/design-system` README**        | The **concrete values**: the exact token-only Tailwind classes each primitive implements                               | `packages/design-system/README.md`                                              |
| **Living showcase** (`apps/showcase`) | The **rendered** contract: every primitive/block in every state on a live URL                                          | [showcase design](../specs/tech/2026-06-29-design-system-showcase-design-en.md) |

A per-class value appears in **one** of these, never copied across two. If you find yourself pasting a Tailwind class into this doc, stop — link to the README table instead.

## How to use this store

- **Before building an element class that is not yet a section below**, dispatch the [`research-ui-element`](../skills/research-ui-element/SKILL.md) subagent. It runs the whitelist + web-first best-practice research and returns a **new section in the template shape below** (findings + 2–3 rendered options + token mapping), ready for the product owner's Stage-A pick. Append it here.
- **When a class already has a section**, reuse it — do not re-run the research. If the standard genuinely needs to change, revise the section in place (paper-architecture: inline rewrite, not an amendment block — AGENTS.md §6) and note the driver in the PR.
- Un-researched classes are **populated on demand**, never stubbed ahead of need (no untracked seam — AGENTS.md §6).

## Web-first research sources

Ground every section in **web** design systems and usability research — not Material/Android-led guidance (our surfaces are web):

> GOV.UK Design System · GitHub Primer · Shopify Polaris · IBM Carbon · Adobe React-Aria · Nielsen Norman Group (NN/g) · Baymard Institute.

Adoption candidates come from the ADR-0013 §4 committable whitelist: official **shadcn/ui** (Radix) · **Origin UI** · **Intent UI / JollyUI** (React-Aria) · **Kibo UI**.

## Section template

Each element-class section carries exactly these fields:

```md
## <Element class> · status: researched | on-demand

**Unit & states.** <the unit and its full state set: default / hover / active /
focus-visible / disabled / loading / invalid / empty …>
**Best-practice principle.** <the researched rule, 2–4 lines — the WHY>
**Citations.** <web-first sources, linked>
**Adopted from.** <registry block, or "bespoke — whitelist search returned no fit because …">
**Rendered options + owner pick.** <the 2–3 options shown at Stage A and which the owner chose>
**Token / primitive mapping.** <which @ds/design-system primitive + a link to the README class table>
**Rendered contract.** <link to the showcase section that renders it>
**Decision & enforcement.** <link to ADR-0013 §7 + the guard(s) that machine-check it>
```

## Element-class taxonomy

| Class                      | Status                    | Primitive(s)                      | Section                         |
| -------------------------- | ------------------------- | --------------------------------- | ------------------------------- |
| Button / action controls   | researched                | `Button`                          | [↓](#button--action-controls)   |
| Field / text input         | researched                | `Input`, `FormItem`/`FormControl` | [↓](#field--text-input)         |
| Error & validation display | researched                | `FormMessage`, `FormError`        | [↓](#error--validation-display) |
| Tabs / segmented control   | researched                | `Tabs`/`TabsTrigger`              | [↓](#tabs--segmented-control)   |
| Link / navigation          | researched                | `Link`                            | [↓](#link--navigation)          |
| Menu / dropdown            | on-demand                 | —                                 | populated on first use          |
| Modal / popover / dialog   | on-demand                 | —                                 | populated on first use          |
| Image / media              | on-demand                 | —                                 | populated on first use          |
| Motion / transition        | researched (async-submit) | `Button.loading`                  | [↓](#motion--transition)        |
| Elevation / shadow         | on-demand                 | —                                 | populated on first use          |

---

## Button / action controls

**status: researched** — seeded from ADR-0013 §7 (auth slice #270/#324).

**Unit & states.** The action control in its variant set (default / secondary / outline / ghost / link) across default → hover → active → focus-visible → disabled → loading.

**Best-practice principle.** A clickable declares its **full** state set as a contract, never per-page diligence: pointer cursor when enabled, a visible hover change, an `active:` press, a keyboard focus-visible ring, an unambiguous disabled treatment, and a determinate pending affordance on async submit. A control with an arrow cursor, no hover feedback, or no focus ring is a **defect, not a pass**. Disabled is told apart from a quiet `secondary` by the **combination** `opacity-50` + not-allowed cursor + inert `pointer-events-none` (secondary keeps a `border-input`, pointer cursor and live hover) — never by fill depth alone (#2).

**Citations.** [NN/g — button states](https://www.nngroup.com/articles/) · [Adobe React-Aria Button](https://react-spectrum.adobe.com/react-aria/Button.html) · [GitHub Primer Button](https://primer.style/product/components/button/) · WCAG 2.2 focus-appearance (2.4.11).

**Adopted from.** shadcn/ui `Button` (Radix), re-skinned to tokens.

**Rendered options + owner pick.** Filled fill/hover/pressed triad approved on the auth slice (#270): resting `primary-action` (blue.700) → `primary-hover`/`primary-pressed` (blue.800).

**Token / primitive mapping.** `Button` composing `interactiveBase` → `packages/design-system/README.md` → _Clickable state matrix_ for the exact classes.

**Rendered contract.** Showcase → Primitives → Button (every variant × state).

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md) layers 1–4; guards `interaction-states` (#269), `aa-contrast` (#402).

## Field / text input

**status: researched** — seeded from ADR-0013 §7 (form-layout & validation contract, #322/#333).

**Unit & states.** A single labelled field (label ↔ control ↔ on-demand message) at rest / filled / focus / invalid, on the form's vertical rhythm.

**Best-practice principle.** Vertical rhythm is a **contract**: label↔control tight but ring-clearing (so the focus ring never touches the label), field-group spacing **larger** than the in-field gap so an on-demand message reads as belonging to **its** field (proximity / Gestalt). Validation fires **on blur** (`onTouched`), never mid-typing. No reserved blank line under a resting field (that over-spaces every form — the slice-B K-1 defect); the message renders **on demand**.

**Citations.** [Baymard — inline form validation](https://baymard.com/blog/inline-form-validation) · [NN/g — form design](https://www.nngroup.com/articles/errors-forms-design-guidelines/) · [GOV.UK — text input](https://design-system.service.gov.uk/components/text-input/) · [Shopify Polaris — text field](https://polaris.shopify.com/components/selection-and-input/text-field).

**Adopted from.** shadcn/ui `Form` + `Input` (Radix), re-skinned.

**Rendered options + owner pick.** #333 Stage-A: reserved-line vs inline-swap vs summary — owner picked **inline swap, no reserved line**; tight `gap-2.5` / `space-y-4` rhythm.

**Token / primitive mapping.** `FormItem`/`FormControl`/`Input` → `packages/design-system/README.md` → _Form layout standard_ table.

**Rendered contract.** Showcase → Primitives → Input / Field.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guards `form-rhythm` (#334), `interaction-states`.

## Error & validation display

**status: researched** — seeded from ADR-0013 §7 (form-layout & validation contract, #333).

**Unit & states.** The field-level message (helper ↔ error swap) and the form-level submit/auth error; short-form inline vs long-form (>3 fields) summary panel.

**Best-practice principle.** Mark the **field, not the text**: invalidity is carried by the input border + a destructive focus ring + the message; the **label stays neutral** (red label + red helper + red message is "red mush", K-3). The message renders **on demand directly under its control**, swapping into the helper's place on failure — never a permanent blank line, never colour alone. Long forms (>3 fields) collect errors into one **summary panel below the submit button** with focus moved to it (GOV.UK / Primer). The error look is owned in **one** primitive, never a hand-typed `<p role="alert">` per page.

**Citations.** [NN/g — error messages](https://www.nngroup.com/articles/errors-forms-design-guidelines/) · [GOV.UK — error summary](https://design-system.service.gov.uk/components/error-summary/) · [GitHub Primer — forms](https://primer.style/product/ui-patterns/forms/) · [Material — errors](https://m1.material.io/patterns/errors.html) _(cross-check only; web sources lead)_.

**Adopted from.** shadcn/ui `FormMessage` pattern; `FormError` bespoke wrapper over the same tone constants.

**Rendered options + owner pick.** #333: text size + label-colour behaviour — owner picked **`text-xs`, non-bold, neutral label**. `<FormErrorSummary>` **deferred** to the first >3-field form (no unused component).

**Token / primitive mapping.** `FormMessage` / `FormError` → `packages/design-system/README.md` → _Form layout standard_.

**Rendered contract.** Showcase → Primitives → Field (invalid state).

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guards `form-error` (#339), `form-rhythm` (#334).

## Tabs / segmented control

**status: researched** — seeded from ADR-0013 §7 (K-2, redone in #333).

**Unit & states.** A segmented switch (each segment a different form/view): inactive / hover / active / focus / disabled.

**Best-practice principle.** Segments need **visible separation** — a `gap-2` track between them — so an inactive segment's hover fill never butts flush against the active segment and reads as one glued block (the slice-B K-2 defect). A connected track tips a segmented control toward **tabs** once its segments show different views; either is acceptable if the separation is explicit.

**Citations.** [GitHub Primer — segmented control](https://primer.style/components/segmented-control) · [The Component Gallery — segmented control](https://component.gallery/components/segmented-control/).

**Adopted from.** shadcn/ui `Tabs` (Radix), re-skinned.

**Rendered options + owner pick.** #333: gap-pills vs underline-tabs — owner picked **gap-pills**.

**Token / primitive mapping.** `Tabs`/`TabsTrigger` (`TabsList` `gap-2`) → `packages/design-system/README.md` → _Clickable state matrix_.

**Rendered contract.** Showcase → Primitives → Tabs.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guard `interaction-states`.

## Link / navigation

**status: researched** — seeded from ADR-0013 §7 (#3, #324).

**Unit & states.** Standalone nav link vs in-body link: resting / hover / active / focus / disabled.

**Best-practice principle.** A link stays visibly a link and changes **clearly on hover and focus**, never relying on colour alone: persistent brand colour + hover-underline + a keyboard focus ring identical to the hover affordance (WAI consistency). Standalone nav links carry **no resting underline** (colour + hover-underline + focus ring suffice); in-body links keep a resting underline. Link text uses **`primary-action` (blue.700, 8.14:1 on white)** — `primary` (blue.500) is only ~3.3:1 and fails AA for normal-weight text.

**Citations.** [NN/g — links](https://www.nngroup.com/articles/) · WCAG 2.2 §1.4.1 (use of colour), §1.4.3 (contrast) · [GOV.UK — links](https://design-system.service.gov.uk/styles/links/).

**Adopted from.** bespoke `Link` primitive composing `interactiveBase` (whitelist has no dedicated link primitive; the base fragment carries the a11y contract).

**Token / primitive mapping.** `Link` → `packages/design-system/README.md` → _Clickable state matrix_ (`link` row).

**Rendered contract.** Showcase → Primitives → Link.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guards `interaction-states`, `aa-contrast`.

## Motion / transition

**status: researched** (async-submit only) — seeded from ADR-0013 §7 (async-submit pending standard, #337).

**Unit & states.** The pending affordance on an async submit; `prefers-reduced-motion` behaviour.

**Best-practice principle.** Every async submit drives a **determinate** pending affordance from its in-flight flag (`loading={isSubmitting}`, never a bare `disabled`): a static disabled control is indistinguishable from a dead one. The pending state also serves as the double-submit guard, and is neutralised under `prefers-reduced-motion` (spin stops; `aria-busy` still announces). Broader motion (enter/exit, list, page transition) is **on-demand** — research when the first such surface is built.

**Citations.** [NN/g — progress indicators / response times](https://www.nngroup.com/articles/response-times-3-important-limits/) · WCAG 2.2 §2.3.3 (animation from interactions) · [Adobe React-Aria — pending](https://react-spectrum.adobe.com/react-aria/Button.html).

**Adopted from.** `Button.loading` (layer-2 primitive, #273).

**Token / primitive mapping.** `Button.loading` → `packages/design-system/README.md` → _Async-submit pending_.

**Rendered contract.** Showcase → Primitives → Button (loading state).

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guard `submit-pending` (#337).
