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

Adoption candidates come from the ADR-0013 §4 committable whitelist: official **shadcn/ui** (Radix) · **Intent UI / JollyUI** (React-Aria) · **Kibo UI**. (Origin UI left the whitelist on 2026-08-27 — see ADR-0013 §4.)

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

| Class                               | Status                    | Primitive(s)                                   | Section                                     |
| ----------------------------------- | ------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Button / action controls            | researched                | `Button`                                       | [↓](#button--action-controls)               |
| Field / text input                  | researched                | `Input`, `FormItem`/`FormControl`              | [↓](#field--text-input)                     |
| Native single-select                | researched                | `NativeSelect`                                 | [↓](#native-single-select)                  |
| Select / combobox (labeled options) | researched                | `Combobox`                                     | [↓](#select--combobox-with-labeled-options) |
| Data table / admin list             | researched                | `Table`, `DataTable`                           | [↓](#data-table--admin-list)                |
| Pagination                          | researched                | `Pagination`                                   | [↓](#pagination)                            |
| Empty state                         | researched                | `EmptyState`                                   | [↓](#empty-state)                           |
| Filter bar / list filtering         | researched                | `FilterBar`                                    | [↓](#filter-bar--list-filtering-model)      |
| Form field group / layout           | researched                | `FormSection`, `FormFieldGroup`, `FormActions` | [↓](#form-field-group--form-layout)         |
| Error & validation display          | researched                | `FormMessage`, `FormError`, `FormErrorSummary` | [↓](#error--validation-display)             |
| Tabs / segmented control            | researched                | `Tabs`/`TabsTrigger`                           | [↓](#tabs--segmented-control)               |
| Link / navigation                   | researched                | `Link`                                         | [↓](#link--navigation)                      |
| Menu / dropdown                     | on-demand                 | —                                              | populated on first use                      |
| Modal / popover / dialog            | on-demand                 | —                                              | populated on first use                      |
| Image / media                       | on-demand                 | —                                              | populated on first use                      |
| Motion / transition                 | researched (async-submit) | `Button.loading`                               | [↓](#motion--transition)                    |
| Elevation / shadow                  | on-demand                 | —                                              | populated on first use                      |

---

## Button / action controls

**status: researched** — seeded from ADR-0013 §7 (auth slice #270/#324).

**Unit & states.** The action control in its variant set (default / on-primary / secondary / outline / ghost / link) across default → hover → active → focus-visible → disabled → loading.

**Best-practice principle.** A clickable declares its **full** state set as a contract, never per-page diligence: pointer cursor when enabled, a visible hover change, an `active:` press, a keyboard focus-visible ring, an unambiguous disabled treatment, and a determinate pending affordance on async submit. A control with an arrow cursor, no hover feedback, or no focus ring is a **defect, not a pass**. Disabled is told apart from a quiet `secondary` by the **combination** `opacity-50` + not-allowed cursor + inert `pointer-events-none` (secondary keeps a `border-input`, pointer cursor and live hover) — never by fill depth alone (#2).

**Citations.** [NN/g — button states](https://www.nngroup.com/articles/) · [Adobe React-Aria Button](https://react-spectrum.adobe.com/react-aria/Button.html) · [GitHub Primer Button](https://primer.style/product/components/button/) · WCAG 2.2 focus-appearance (2.4.11).

**Adopted from.** shadcn/ui `Button` (Radix), re-skinned to tokens.

**Rendered options + owner pick.** Filled fill/hover/pressed triad approved on the auth slice (#270): resting `primary-action` (blue.700) → `primary-hover`/`primary-pressed` (blue.800). Feature 013 Stage B confirmed that a CTA on the invariant navy primary surface uses the Canvas white action: white fill, navy text, and a dark hard offset cast; the default filled action is not reused because it blends into that surface in light mode.

**Token / primitive mapping.** `Button` composing `interactiveBase` → `packages/design-system/README.md` → _Clickable state matrix_ for the exact classes. On `primary-surface`, product code requests `variant="on-primary"`; the primitive owns the invariant `header-foreground` / `header-chip-foreground` / `shadow-header-chip` composition, with no app-level colour override.

**Rendered contract.** Showcase → Primitives → Button (every variant × state), including `on-primary` on the real navy surface in both themes.

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

## Native single-select

**status: researched** — Feature 013 / Issue #1312.

**Unit & states.** One labelled, required, compact single-select for a short,
fixed vocabulary, covering empty placeholder, filled, hover, active,
focus-visible, invalid with an on-demand message, and disabled. The browser owns the open option list;
the closed control aligns visually with the adjacent owned `Input`. A real role
is never preselected.

**Best-practice principle.** Prefer radios when a short list fits without
damaging the form composition. Here the approved Academy form deliberately uses
one compact «Роль» line in an already dense column, so a native `<select>` is
the narrow exception: it preserves keyboard, type-ahead, form, and mobile-picker
semantics without rebuilding a popover. The visible label remains outside the
control; invalidity is carried by the control and its on-demand message, while
focus-visible and disabled remain unambiguous.

**Citations.** [GOV.UK Select](https://design-system.service.gov.uk/components/select/)
· [GitHub Primer Select guidelines](https://primer.style/product/components/select/guidelines/)
· [IBM Carbon Select](https://carbondesignsystem.com/components/select/usage/)
· [Adobe React Aria Select](https://react-aria.adobe.com/Select)
· [Baymard drop-down usability](https://baymard.com/blog/drop-down-usability)
· [Baymard custom drop-down pitfalls](https://baymard.com/blog/custom-dropdowns-cause-issues).

**Adopted from.** Official
[shadcn/ui `NativeSelect`](https://ui.shadcn.com/docs/components/radix/native-select),
MIT: adopt its thin native-select plus decorative-chevron composition and
re-skin it to DS tokens. The whitelist alternatives were rejected for this
five-value field: Origin UI had weaker current provenance; Intent UI/JollyUI
required a heavier React-Aria popover boundary; Kibo UI's closest fit was an
overbuilt searchable combobox.

**Rendered options + owner pick.** Stage A compared A — Input parity with a
quiet DS chevron; B — the browser-native arrow; and C — a divided trailing
chevron rail. On 2026-08-16 the Product Lead picked **A — Input parity** because
it continues the already approved form geometry without adding visual weight.

**Token / primitive mapping.** Add an owned `NativeSelect` beside `Input`,
composed through `Label`, `FormItem`, `FormControl`, and `FormMessage`. Match the
owned Input's control size, inset, square shape, structural border, and text
scale. Empty, filled, focus-visible, invalid, and disabled use the existing
semantic field tokens; the pointer-inert decorative chevron is hidden from
accessibility APIs. Concrete classes live only in the design-system README.

**Rendered contract.** Showcase → Primitives → NativeSelect: the exact role list
in order, plus empty, filled, focus-visible, invalid with message, and disabled
states in both themes. Desktop and mobile live checks cover native keyboard,
type-ahead, selection, and open/close behavior.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md)
layers 1–4; owned primitive tests pin label association, forwarding, option
order, disabled, and `aria-invalid`. Existing `interaction-states`,
`primitives-first`, `aa-contrast`, `form-error`, and `form-rhythm` guards enforce
the composition; Stage B reconfirms both themes and breakpoints before merge.

## Select / combobox with labeled options

**status: researched** — admin shell redesign / Issue #1578.

**Unit & states.** One labelled picker over a **closed vocabulary** — a control that shows the chosen human-readable label, plus the list surface that offers the options. Two realizations of the same unit: the **native select** (browser owns the list — covered in [Native single-select](#native-single-select)) and the **combobox** (the app owns the list, so it can carry a per-option explanation, a filter box, grouping and an empty state). The combobox adds, on top of the shared field state set (empty placeholder / filled / hover / active / focus-visible / invalid + on-demand message / disabled), four states the native select has no vocabulary for: **open**, **filtering** (query typed, count narrowed), **no-match**, and **loading** when the vocabulary is fetched. A slug, code or numeric id is never the rendered label, in the control or in the list.

**Best-practice principle.** The realization is chosen by the vocabulary, not by taste, and the deciding question is _what the operator must be told to pick correctly_ — not only how many options there are.

- **Native select is the default and stays the default.** GOV.UK is blunt that selects are already the last resort in public services because users struggle to close them, try to type into them, and confuse focused with selected; Baymard found 31% of hand-built dropdowns break keyboard access, focus visibility, character-based selection, or viewport-aware opening. Every one of those is functionality a native `<select>` gives free. Rebuilding it is a debt taken on deliberately, and only for a capability the native control cannot express.
- **Three triggers, any one of which requires a combobox.** (1) **The options need explaining** — an option whose meaning is not self-evident from its label needs a secondary line beside it, and a native `<option>` cannot hold one (the #1578 «Вид связи» case: the operator must be told what each relation kind _does_ to targeting, and a hint under the label can only describe the field, not the five options). (2) **The list outgrows scanning** — Primer puts the radio→select boundary at ~6 options; past roughly 12–15 the operator can no longer see the set at once and scrolling replaces scanning, and past that a filter box is the cure NN/g names. (3) **The vocabulary is data, not a constant** — a managed book that grows (the Минздрав specialty nomenclature, the directions book) is unbounded by construction and must be filterable and, for a long book, fetched.
- **A closed vocabulary stays closed.** The picker never accepts a value outside the set: custom values are off, the free-text box is retired, and the API contract moves from a shape CHECK (any lowercase slug) to an enumerated set. A vocabulary that a typo can extend is not a vocabulary.
- **Whatever is rebuilt owes the whole native contract back.** The ARIA combobox pattern is the acceptance list, not a nice-to-have: `role="combobox"` with `aria-expanded`, `aria-controls` on the live popup, keyboard open/move/accept/close. Add the two Baymard failures ARIA does not cover: the panel opens away from a viewport edge, and the visible label stays readable while the list is open.
- **Below the trigger threshold the combobox is the wrong answer**, even once the block exists. Filtering five options is friction; a search box over a list that fits on screen is a control asking to be used and offering nothing.

**Citations.** [GOV.UK Select](https://design-system.service.gov.uk/components/select/) · [Baymard — custom dropdowns cause issues](https://baymard.com/blog/custom-dropdowns-cause-issues) · [NN/g — drop-down menus](https://www.nngroup.com/articles/drop-down-menus/) · [GitHub Primer — Select guidelines](https://primer.style/product/components/select/guidelines/) · [W3C WAI-ARIA APG — combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) · [Adobe React Aria ComboBox](https://react-aria.adobe.com/ComboBox) · [IBM Carbon Dropdown usage](https://carbondesignsystem.com/components/dropdown/usage/).

**Adopted from.** **Kibo UI `combobox`** ([shadcnblocks/kibo](https://github.com/shadcnblocks/kibo), MIT — Copyright (c) 2023 — Present shadcnblocks, full notice reproduced verbatim in `combobox.tsx`) — the classic shadcn recipe (Popover + Command over `cmdk`) packaged as a ready block with controlled-state plumbing wired, re-skinned to DS tokens on copy-in. Registry sweep run 2026-08-27 against the real registry payloads: **shadcn/ui** rejected for now (its current official Combobox has moved off Radix onto Base UI, a dependency family we do not have; the Radix route is not a packaged block but a hand assembly of `popover` + `command` — the very thing #1578 exists to stop); **Origin UI** off the whitelist (ADR-0013 §4 — `origin-space/originui` now resolves into `cosscom/coss`, AGPL-3.0 by default with `apps/origin/` carved back to MIT, so every copy needs a per-directory provenance check against a collection that stopped moving); **Intent UI / JollyUI** rejected on availability + weight (the JollyUI registry host answers 402; Intent UI is alive but brings the whole `react-aria-components` runtime — a third a11y stack beside Radix and the native controls). Net new dependencies: `cmdk` and `@radix-ui/react-popover` — both widen the Radix family already installed rather than opening a new one.

**Rendered options + owner pick.** Stage A rendered at 1440 px on real tokens over the #1578 form: **А — native select with RU labels** (zero new deps, but per-option explanations have nowhere to live and the long specialty book gets no filter); **Б — field-shaped trigger with an owned popup** (closed control pixel-identical to `Input`/`NativeSelect`; short vocabulary shows five options each with its explanation line and no search box, a long book grows an in-panel search row with a «Найдено N из M» count and a no-match line; typing happens in the panel, never in the field); **В — editable field, type-to-filter in place** (fastest for a known name, but the resting text is ambiguous between "chosen" and "half-typed" and it invites free text into a closed vocabulary). On 2026-08-27 the Product Lead picked **Б**, on the Kibo UI base ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)) — the closed vocabulary must stay closed, and the explanation line is the whole reason this is not a native select.

**Token / primitive mapping.** Owned `Combobox` **block** in `@ds/design-system` (`src/blocks/combobox.tsx`) — a block, not a primitive, because it composes a popover surface and a list engine rather than a single control; it wires through `Label` / `FormItem` / `FormControl` / `FormMessage` like any field. The **closed control reuses the `NativeSelect` geometry exactly** — same height, inset, square radius, 2px structural border, `text-sm`, same trailing chevron position — so a form mixing the two realizations reads as one column. The popup is a surface, not a new colour system: `card` ground, structural `border` weight, the existing hard offset shadow, square `radius-base`. The highlighted option uses `tint` / `tint-foreground`, the selected tick `primary-action`, and the per-option explanation, «Найдено N из M» counter and no-match line are `muted-foreground`. Concrete classes live only in the design-system README.

**Rendered contract.** Showcase → Blocks → Combobox: the short explained vocabulary and the long filterable book, closed / open / filtering / no-match, plus filled, invalid and disabled, in both themes and both breakpoints. Because this control replaces native behaviour, live verification is part of the contract: keyboard-only open → arrow → Enter → Escape, panel placement near the viewport bottom edge, and the label still readable while open.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md) layers 1–4. Block tests pin the ARIA contract (`role="combobox"`, `aria-expanded`, `aria-controls`), the closed-vocabulary rule (typing never commits a value outside `options`), per-option explanations, the search threshold and the no-match state, and — the #1578 rule — that no option's rendered text is its slug. Existing `interaction-states`, `primitives-first`, `aa-contrast`, `form-error` and `form-rhythm` guards enforce the composition; the `registry-research` guard records the adoption. Stage B reconfirms both themes and breakpoints before merge.

## Data table / admin list

**status: researched** — Issue #1578 (admin shell redesign on ready-made blocks), first realization = `apps/admin` taxonomy lists (directions / specialty links / experts / topics / partners).

**Unit & states.** One operator list surface: header + primary action → filter bar → column header row → data rows → pagination footer. Its state set is `loading` (skeleton rows, header already drawn) / `error` / `empty — no records at all` / `empty — no results for the current filters` / `populated`, and per row `default` / `hover` / `focus-visible` / `row action`. Each column declares its own contract — width behaviour, alignment (text left, numeric right), and overflow behaviour (truncate-with-full-title · clamp to two lines) — so a long RU title is a designed outcome, not an accident of the content.

**Best-practice principle.** A data table is a **column contract**, not an HTML `<table>` with whatever widths the browser picks. (1) **Width is declared per column, never inferred.** Primer's DataTable makes width an explicit per-column property; React Aria's table takes `width` / `minWidth` / `maxWidth`. Without that contract the browser re-lays the grid on every page of data and the same list looks different on every filter. (2) **Overflow is designed, and the full value stays reachable.** React Aria's resizable-table CSS ships `text-overflow: ellipsis` on the cell; Carbon requires wrapping a long title to two lines and then truncating, with the full text available on hover. Truncation is legitimate **only** when the full string remains reachable (native `title` / the detail page) — a silently cut record name with no way back is the defect, not the ellipsis. (3) **Give the table the width and let the layout absorb the rest.** Carbon places data tables in the main content area with space enough to avoid truncation; GOV.UK splits a lot of data across tables or pages rather than one unwieldy grid, and shrinks the type on narrow viewports instead of silently hiding columns. Beyond width: numeric columns align right so figures scan as a column; the first column carries a human-readable record identifier rather than a "mystery meat" generated id, and column order reflects importance to the user (NN/g); every column header is a real `<th scope="col">`; the row-action column is last with a visually hidden header, at most one inline action (Primer). Density is a chosen size — Carbon's xl two-line row is "only recommended if your data is expected to have two lines of content", which is exactly the RU taxonomy case.

**Citations.** [GOV.UK — table](https://design-system.service.gov.uk/components/table/) · [GitHub Primer — DataTable](https://primer.style/product/components/data-table/) · [IBM Carbon — data table usage](https://carbondesignsystem.com/components/data-table/usage/) and [style](https://carbondesignsystem.com/components/data-table/style/) · [Adobe React Aria — Table](https://react-aria.adobe.com/Table) · [NN/g — data tables](https://www.nngroup.com/articles/data-tables/) · [shadcn/ui — Table](https://ui.shadcn.com/docs/components/table) and [Data Table](https://ui.shadcn.com/docs/components/data-table).

**Adopted from.** Official **shadcn/ui `Table`** (MIT) — a plain semantic `<table>` set with **no Radix dependency** — copied verbatim into `packages/design-system/src/blocks/table.tsx` (upstream notice preserved) and re-skinned to tokens, wrapped by an owned `DataTable` block that owns the column contract, the states and the footer. Whitelist result, checked 2026-08-27: **Origin UI** off the whitelist (ADR-0013 §4 — mixed per-directory licensing after `origin-space/originui` → `cosscom/coss`, plus a collection frozen at the absorption); **Intent UI / JollyUI** rejected on weight (MIT and the richest feature set, but it pulls the whole `react-aria-components` runtime — revisit only if operator column-resize becomes a requirement); **Kibo UI** rejected as the same engine with more surface (shadcn `Table` + `@tanstack/react-table` **plus Jotai**).

**Dependency assessment — `@tanstack/react-table` is deferred, not refused.** It is a **client-side** table engine: sorting, filtering, pagination and column visibility computed in the browser over a fully loaded row array. Our admin lists are **server-queried** — `q`, `status`, `includeRetired`, `page`, `pageSize` go to the API and one page of rows comes back — so on day one TanStack would manage a 20-row array we already hold in the right order, for a new runtime dependency plus per-column boilerplate. The `DataTable` block therefore takes a declarative column array (`key · header · width · align · overflow · render · fullValue`) matching the Primer/React-Aria width vocabulary, and shadcn's TanStack `DataTable` recipe is the documented upgrade path, taken when an operator list first needs **client-side** column ops (resize, hide, multi-sort, batch selection). Recorded here so the deferral is a decision, not an untracked seam.

**Rendered options + owner pick.** Stage A rendered three options at 1440 and 390 CSS px on real tokens with real RU taxonomy rows including a deliberately long one: **А — фиксированная сетка колонок** (declared widths, one line per cell, ellipsis + full value in `title`; densest, but on 390 px the table scrolls horizontally and columns leave the screen); **Б — запись в две строки** (the name column wraps to two lines over a muted context line, nothing ever cut — Carbon's xl row); **В — таблица + карточки записей** (А's grid at ≥768 px, stacked record cards below it, no horizontal scroll on a phone). On 2026-08-27 the Product Lead picked **Б on desktop combined with В's mobile card rendering** ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)): the record row is two lines and nothing is cut mid-glance, long non-title cells ellipsis with the full value on `title`, and below 768 px the grid becomes stacked record cards so a phone **never** scrolls horizontally.

The same pick settles row activation: a **single-action list has no «Действия» column — the whole row opens the record**, and an actions column exists only when a row genuinely has ≥2 actions. That is a prop on the block, never a per-app hack: the record cell carries a real link/button so assistive tech gets the semantics and the keyboard a visible focus ring, and its stretched overlay makes the whole row a click target with `cursor-pointer` and a hover cue (ADR-0013 §7).

**Token / primitive mapping.** `Table` (verbatim shadcn markup, re-skinned) + the owned `DataTable` block in `@ds/design-system`, replacing the hand-composed `apps/admin/components/admin-list-shell.tsx` table. Structural chrome uses the flat-brand tokens — `border` / `hairline` at the 2px structural weight, `card` for the surface, `accent` for the header row, `tint` for row hover, `radius-base` (0) throughout; text uses `foreground`, `muted-foreground` for the record's second line and `faint` for metadata; status chips reuse the `success-tint` / `warning-tint` / `destructive-tint` + `*-text` pairs, never a raw hex; numeric cells take tabular numerals. Concrete classes live only in `packages/design-system/README.md`.

**Rendered contract.** Showcase → Blocks → DataTable: the same RU row set in populated, loading, error, both empty states and the actions variant, at both breakpoints and both themes, plus a long-value row proving the declared overflow behaviour and a keyboard pass over row activation.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md) layers 1–4; guards `primitives-first` (an app-local `<table>` in `apps/*` is a violation once the block exists), `interaction-states` (row hover + row-activation focus-visible), `aa-contrast`, `playwright-axe` (table semantics: `<th scope="col">`, caption/accessible name, no layout tables). Block tests pin the column contract: declared widths applied, numeric alignment, the full value reachable on a truncated cell, row activation as a real link/button, the actions column only when actions are supplied, and the state routing.

## Pagination

**status: researched** — Issue #1578; renders inside the data-table footer.

**Unit & states.** The list footer: a range/total readout («Показаны 1–20 из 137») plus a `<nav aria-label>` carrying previous / next and page numbers with an ellipsis. States: first page (previous absent), middle page, last page (next absent), single page (the whole control absent), and loading (controls inert while the next page is in flight).

**Best-practice principle.** GOV.UK is explicit and we follow it literally: paginate when showing everything on one page makes it too slow or when most users only need the first pages; "do not show pagination if there's only one page of content"; "do not show the previous page link on the first page – and do not show the next page link on the last page"; and **never** infinite scroll, which "causes problems for keyboard users". The number list is responsive by rule — current page, one either side, first and last, ellipses replacing skipped pages, the neighbour count shrinking on small screens. The accessibility contract belongs to the component, not the page: a `<nav>` with an accessible name, `aria-current="page"` on the current page, and visually hidden per-link text. A disabled-looking previous button that is still focusable and does nothing is the failure mode this rules out.

**Citations.** [GOV.UK — pagination](https://design-system.service.gov.uk/components/pagination/) · [NN/g — data tables](https://www.nngroup.com/articles/data-tables/) · [shadcn/ui — Data Table (pagination section)](https://ui.shadcn.com/docs/components/data-table).

**Adopted from.** Official **shadcn/ui `Pagination`** (MIT) copied verbatim and re-skinned; its anchor-based previous / link / next / ellipsis set already matches GOV.UK's markup contract. Origin UI's pagination samples are excluded for the same whitelist reason as the table.

**Rendered options + owner pick.** Stage A: **П1 — номера страниц** (range readout + prev/next + 1 2 3 … 7; the operator jumps to any page); **П2 — только «Назад / Вперёд»** with «Страница N из M» (simplest, but no jumping); **П3 — номера + «Строк на странице»** (П1 plus a page-size select for dense reference books). On 2026-08-27 the Product Lead picked **П1** ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)) — an operator who knows a record sits near the end jumps there instead of pressing «дальше» nine times, and the page-size control is not yet earned.

**Token / primitive mapping.** `Pagination` block composing `interactiveBase`, consumed by the `DataTable` footer. The current page uses `primary-surface` / `primary-surface-foreground`; inactive numbers use `primary-action` text on the transparent track; prev/next reuse the `Button` outline variant with its own disabled contract (`opacity-50` + `pointer-events-none` + not-allowed cursor — never a look-alike); the readout is `muted-foreground` at `font-size-sm` with tabular numerals. Classes live in the DS README.

**Rendered contract.** Showcase → Blocks → Pagination: first / middle / last / single-page / loading, both themes, plus a keyboard pass proving focus order and `aria-current`.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guards `interaction-states`, `aa-contrast`, `playwright-axe` (nav landmark + `aria-current`). Block tests pin: no render at one page, no previous on page 1, no next on the last page, `aria-current` on exactly one link.

## Empty state

**status: researched** — Issue #1578; renders inside the data-table body and, later, any other collection surface.

**Unit & states.** A centred block spanning the full table body — heading, one explanatory line, at most one action — in **two distinct variants that must not be collapsed into one string**: (a) _раздел ещё пуст_ — no records exist at all; (b) _ничего не найдено_ — records exist but the current `q` / `status` / toggle combination matched none. A third state, `error`, is a different unit (alert), not an empty state.

**Best-practice principle.** An empty table is a message, not an absence. NN/g: a simple message communicates the state of the system and increases user confidence; empty states double as the teaching moment and should carry a direct path forward. The no-results variant additionally **names what was applied and offers the way out**, so the operator is not left guessing whether the list is broken or their query was too narrow. NN/g's explicit warning is our loading rule: never show "no records" before data has arrived — a message that flips to content erodes trust substantially, so the loading state, not the empty state, owns the in-flight moment. The first-use variant gets the primary action; the no-results variant gets a quiet secondary «Сбросить фильтры» — the operator already has the create button in the page header, and offering "create" as the answer to a failed search misreads intent.

**Citations.** [NN/g — empty states](https://www.nngroup.com/articles/empty-state-interface-design/) · [GOV.UK — pagination / one-page rule](https://design-system.service.gov.uk/components/pagination/) · [shadcn/ui — Data Table "No results." row](https://ui.shadcn.com/docs/components/data-table).

**Adopted from.** shadcn/ui's `DataTable` empty row (MIT) as the structural seam — a single `TableCell` with `colSpan` inside the table body, so the column header row stays drawn and the surface does not jump — with the copy and the action layered on top per NN/g (the shadcn default, a bare "No results.", is the minimum this section replaces). The whitelist has no richer licence-clean empty-state block: Origin UI is off the whitelist, Kibo has none, Intent UI's is tied to its React-Aria collection.

**Rendered options + owner pick.** Both variants were presented as **one contract, not a choice** — «Направлений пока нет» with the primary create action, and «По запросу … ничего не найдено» with a secondary «Сбросить фильтры»; the Stage-A question was the RU copy register, not the structure. On 2026-08-27 the Product Lead confirmed the two-variant contract with that register ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)).

**Token / primitive mapping.** `EmptyState` block consumed by `DataTable` and reusable by any collection surface. Heading at `font-size-base` / `font-weight-bold` on `foreground`; body at `font-size-sm` on `muted-foreground`, capped near 44ch; the action is the existing `Button` (default for create, outline for reset). No illustration token exists yet — an illustrated empty state would be a separate image/media research pass. Classes in the DS README.

**Rendered contract.** Showcase → Blocks → EmptyState: both variants, inside a DataTable and standalone, both themes; the no-results variant rendered with an actual filter value interpolated.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md); guards `aa-contrast`, `interaction-states`, `playwright-axe`. Block tests pin the two variants as separate props (never one `emptyLabel` string — the current `AdminListShell` collapses them, which is the defect this section closes) and pin that the empty state never renders while `isLoading` is true.

## Filter bar / list filtering model

**status: researched** — Issue #1578.

**Unit & states.** One toolbar above a list that owns every control narrowing it — free-text search, categorical facets, boolean scope toggles — plus the applied-filter readout, the reset affordance and the result count. States: rest · focus-visible on each control · **busy** (a query is in flight — the text field carries a determinate indicator, never a frozen list) · **filtered** (at least one filter active → reset is offered and the applied set is visible) · **empty result** (a filtered-empty message that is not the same string as an unfiltered-empty list) · disabled. Its critical property is not visual — it is the **apply model**: _when_ a control's change reaches the list. That model is a whole-bar contract, never a per-control choice.

**Best-practice principle.** A filter bar runs **exactly one apply model**, and every control obeys it. The mixed model — one control queued behind «Применить» while its neighbours fire on change — is the defect: the operator cannot form a rule for when the list moves, and the button reads as if it applied everything while it applied one field. The two legitimate models are Carbon's **interactive** (each selection _is_ the trigger) and **batch** (nothing moves until an apply button). NN/g routes between them by intent and latency: interactive for exploratory narrowing on a surface that answers in under a second; batch when the user already holds several criteria in mind, or the backend/connection makes each round-trip expensive. For interactive, NN/g pins an inactivity timeout before firing on typed input — that is the debounce; the list must never re-query per keystroke, and must never scroll the viewport on update. Three obligations are unconditional under either model: the **applied set is visible as removable units** (Baymard: 28 % of sites omit the applied-filter overview, leaving no confirmation, no cheap removal and no sense of list scope — a bare «Фильтры (3)» count does not satisfy it); a **clear-all** dismisses every filter in one action; and the result count is announced in a live region. WCAG 3.2.2 does not forbid the interactive model — updating the list below is a change of _content_, not of _context_ — provided focus, viewport and page identity are untouched.

**Citations.** [NN/g — applying filters: interactive vs batch](https://www.nngroup.com/articles/applying-filters/) · [IBM Carbon — filtering pattern](https://carbondesignsystem.com/patterns/filtering/) · [MOJ/GOV.UK — filter a list](https://design-patterns.service.justice.gov.uk/patterns/filter-a-list/) · [Baymard — how to design applied filters](https://baymard.com/blog/how-to-design-applied-filters) · [GitHub Primer — DataTable guidelines](https://primer.style/product/components/data-table/guidelines/) · [W3C — Understanding SC 3.2.2 On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html). MOJ's «Apply filters» button is a _batch_ pattern chosen for no-JS public services — evidence for what batch looks like when chosen, not for choosing batch on a JS-driven internal admin.

**Adopted from.** Official **shadcn/ui `DataTableToolbar`** (the `tasks` example block, MIT): a flex row of `Input` filtering on change with no submit, N faceted-filter popovers, and a reset control rendered **only while filtered**. That composition and its reset/applied semantics are what we adopt — not its plumbing, which is bound to `@tanstack/react-table` column state and pulls `cmdk` + `Checkbox` for the facets. Our filtering is **server-side** (Refine `useList` → API `q`/`status` params), so the block implements the same semantics over our own query state, with faceted multi-select served by the owned `FilterChip`. Whitelist negatives: **Origin UI** ships TanStack-bound table/filter examples, not a state-agnostic toolbar block (and is off the whitelist per ADR-0013 §4); **Kibo UI**'s table is a TanStack + Jotai project-management table with no toolbar block; **Intent UI / JollyUI** offers React-Aria primitives but no filter-bar composition.

**Rendered options + owner pick.** Stage A at 1440 px on real tokens with RU labels: **A — мгновенный фильтр** (the existing bar minus «Применить»: debounced text search with an in-field busy indicator, facets applying on change, a reset that appears only while filtered, and a live-region result count); **Б — явное применение** (every control becomes draft state — needs a persistent «Фильтры изменены» warning, because between edit and apply the table shows a result that no longer matches the controls); **В — мгновенный фильтр + чипы** (A plus the shadcn toolbar's applied semantics on our own primitives: everything active echoed in a «Выбрано:» row, each filter removed by its own ✕, with «Сбросить всё» beside it). On 2026-08-27 the Product Lead picked **В** ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)): instant apply, no apply button, removable chips and «Сбросить всё» visible only while filtered. The routing is not taste — the admin lists are server-paginated queries on a small internal dataset answering well under a second and the operator is exploring, so batch would import a stale-list window and a fourth click per narrowing to solve a latency problem we do not have. **Б becomes the correct answer if the list ever gets slow or gains many facets** — the decision is latency-bound, so it is re-opened by measurement, not by taste.

**Token / primitive mapping.** `FilterBar` **block** in `@ds/design-system` (`src/blocks/`), composing owned primitives only — `Input` (search, debounced by the block, never per-keystroke), `FilterChip` (facet + applied units), `NativeSelect` (single-value facet), `Switch` (boolean scope), `Button` (reset; the submit control exists only in the batch variant). The apply model is a **single required prop on the block** (`applyMode`), so a surface cannot mix models by accident and the choice is greppable. Frame and rhythm: `hairline` panel border on `card`; the applied row sits between the bar and the list. Colour: chips resolve `chip-border`/`tint`/`tint-foreground` at rest-hover and `primary-action` + `primary-foreground` selected; the result-count line is `muted-foreground` with the number in `foreground`; the busy indicator is suppressed under `prefers-reduced-motion` in favour of a static `aria-busy`. The filtered-empty message must differ in wording from the unfiltered-empty one. Concrete classes live only in the design-system README.

**Rendered contract.** Showcase → Blocks → FilterBar: both `applyMode` values, and the state ladder — rest, focus-visible on each control, busy, filtered-with-applied-row, filtered-empty — in both themes at both breakpoints. On mobile the bar stacks and the applied row scrolls horizontally with a truncation signal.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md) layers 1–4. Machine checks: `primitives-first` (a hand-composed `<form>` filter bar in an app is a violation once the block exists — `apps/admin/components/admin-list-shell.tsx` is exactly that composition and is the first migration), `interaction-states` + `aa-contrast` on the chips and reset, `playwright-axe` on the live region. Block tests pin the model contract: in `applyMode="instant"` no submit control is rendered and each control commits its own change (text debounced, asserted with fake timers); in `applyMode="batch"` no control commits before submit. That pair is what makes the mixed model unbuildable rather than merely discouraged.

## Form field group / form layout

**status: researched** — Issue #1578.

**Unit & states.** The **layout tier above the field primitive**: a whole CRUD form composed of _sections_ (fieldset + legend + section description) → _field groups_ (one- or two-up rows) → the existing `FormItem` field → the terminal _action row_. Its states are the form's, not a control's: **resting**, **sections traversed by keyboard** (each legend announced when a control inside it takes focus), **submitting** (the action row's primary in `loading`, the form inert to a second submit), **rejected** (per-field messages swap in place + `FormErrorSummary` below submit), and **read-only / locked section** (a section whose fields the server refuses to change, e.g. after first publication). A section is never a bare `<h2>` followed by loose divs — that carries no programmatic grouping, so a screen-reader user hears seven unlabelled fields in a row.

**Best-practice principle.** Three rules, in order of force. (1) **Group, then label the group semantically.** GOV.UK's default is one question per page and grouping is the _evidenced exception_ — permitted precisely for "an internal service for government users who need to repeat and switch between tasks quickly", which is exactly the admin operator; when you group, use a statement as the heading and give the section a real `fieldset` / `legend`. (2) **Single column; two-up only for genuinely paired short fields.** NN/g: multiple columns interrupt the vertical momentum of moving down the form — the exception is brief related fields sharing one row. (3) **Every field's meaning is derivable from what is rendered, and a field the operator must not fill is not rendered at all.** Requirements are visible up front, not hidden in error messages; a hint stays one short sentence and longer context moves up into the section description. Applied here: **`slug` and `weight` are derived, so they are not fields** — the slug appears as a read-only note stating the derived value and when it locks; ordering weight is owned by the list screen's reorder affordance, not by a numeric box on the form. Rhythm, on-blur validation and the on-demand message belong to _Field / text input_; the summary panel belongs to _Error & validation display_. This section owns only what sits **above** them.

**Action row.** One terminal action row per form, **left-aligned** (GOV.UK: the continue button is aligned left so users do not miss it), primary first, with the secondary/cancel at significantly reduced visual prominence to prevent accidental clicks (NN/g). It carries the async-submit pending contract from _Motion / transition_, and it is a **single** row — a per-section save button would make "saved" ambiguous.

**Citations.** [GOV.UK — question pages pattern](https://design-system.service.gov.uk/patterns/question-pages/) · [GitHub Primer — forms UI pattern](https://primer.style/product/ui-patterns/forms/) · [NN/g — web form design](https://www.nngroup.com/articles/web-form-design/) · [Baymard — checkout form-field count](https://baymard.com/blog/checkout-flow-average-form-fields) · [Adobe React Aria — Form](https://react-aria.adobe.com/Form) · [shadcn/ui — Field](https://ui.shadcn.com/docs/components/field) · [shadcn/ui — forms with react-hook-form](https://ui.shadcn.com/docs/forms/react-hook-form).

**Adopted from.** Official **shadcn/ui `Field` family (MIT)** — `FieldSet` / `FieldLegend` / `FieldDescription` / `FieldGroup` / `FieldSeparator`, the layout tier shadcn added _above_ the `Form*` field wrapper we already run. It composes with react-hook-form exactly as our `FormField`/`FormItem` do, needs no new runtime dependency, keeps the RSC boundary at the same client form component, and supplies real `fieldset`/`legend` semantics plus a responsive orientation switch — rule 2's "single column, two-up for paired short fields" without hand-written grid classes at each call site. Whitelist result: **Origin UI** rejected (off the whitelist per ADR-0013 §4 — mixed per-directory licensing inside `cosscom/coss`, and a frozen pre-acquisition collection — a layout tier we will own for years should not start there); **Intent UI / JollyUI** does ship `Form`/`Fieldset`/`Legend`, but on React Aria Components, i.e. a second form-state and focus-management stack beside the Radix/react-hook-form one, which would fork the form contract at the layout tier; **Kibo UI** has no field-group or sectioned-form block.

**Rendered options + owner pick.** Stage A rendered the same «Редактирование направления» form three ways, differing only in the grouping tier: **A — Ruled sections** (one framed panel; sections separated by a `hairline` rule, each opening with a statement heading and a one-line description; fields full-width single column with a two-up row for paired short fields; action row below a closing rule); **B — Framed section cards** (each section its own card with a numbered header band, action row a separate framed bar); **C — Description rail** (two-column section with title, description and a rationale note in a left rail). On 2026-08-27 the Product Lead picked **A — ruled sections** ([Issue #1578 comment 5435209906](https://github.com/doctor-school/ds-platform/issues/1578#issuecomment-5435209906)).

**Token / primitive mapping.** Owned blocks beside the existing `Form*` family, adopted from shadcn `Field` and re-skinned: `FormSection` (`fieldset` + `legend` + description, with a `locked` state) · `FormFieldGroup` (the stacking/columns wrapper) · `FormSeparator` (the rule between sections) · `FormActions` (the terminal action row, primary + reduced-prominence secondary) · `FormDerivedNote` (the "это поле заполняется само" panel that replaces a hidden slug/weight field). They resolve to existing scales only — section rhythm one step above the field-group spacing; legend on the heading scale at `foreground`; section description and derived-note body on the `muted-foreground` helper tier fixed by _Field_; section rule on `hairline`; the derived note on `tint`; the action row's primary on `primary-action` with `Button.loading`. Concrete classes live only in `packages/design-system/README.md` → _Form layout standard_.

**Rendered contract.** Showcase → Blocks → Form section family: one sectioned form in both themes at both breakpoints, showing resting, a locked section, a two-up field group collapsing to one column, and the derived-note panel standing in for a hidden auto-generated field.

**Decision & enforcement.** [ADR-0013 §7](../adr/0013-design-token-sot-en.md) layers 1–4. Block tests pin `fieldset`/`legend` association, the section-description `aria-describedby` wiring, and the single-action-row invariant. Existing `primitives-first`, `interaction-states`, `form-rhythm`, `form-error`, `submit-pending` and `aa-contrast` guards cover the composition; the new machine-checkable rule is **no hand-rolled section heading inside a `<form>`** — a bare `<h2>`/`<div>` acting as a group label instead of `FormSection` is what `apps/admin/components/event-form.tsx` does today and is the defect this section closes (extend the `form-rhythm` guard rather than adding a new one).

## Error & validation display

**status: researched** — seeded from ADR-0013 §7 (form-layout & validation contract, #333).

**Unit & states.** The field-level message (helper ↔ error swap) and the form-level submit/auth error; short-form inline vs long-form (>3 fields) summary panel.

**Best-practice principle.** Mark the **field, not the text**: invalidity is carried by the input border + a destructive focus ring + the message; the **label stays neutral** (red label + red helper + red message is "red mush", K-3). The message renders **on demand directly under its control**, swapping into the helper's place on failure — never a permanent blank line, never colour alone. Long forms (>3 fields) collect errors into one **summary panel below the submit button** with focus moved to it (GOV.UK / Primer). The error look is owned in **one** primitive, never a hand-typed `<p role="alert">` per page.

**Citations.** [NN/g — error messages](https://www.nngroup.com/articles/errors-forms-design-guidelines/) · [GOV.UK — error summary](https://design-system.service.gov.uk/components/error-summary/) · [GitHub Primer — forms](https://primer.style/product/ui-patterns/forms/) · [Material — errors](https://m1.material.io/patterns/errors.html) _(cross-check only; web sources lead)_.

**Adopted from.** shadcn/ui `FormMessage` pattern; `FormError` bespoke wrapper over the same tone constants.

**Rendered options + owner pick.** #333: text size + label-colour behaviour — owner picked **`text-xs`, non-bold, neutral label**. Feature 013 / #1312 is the first >3-field realization: `FormErrorSummary` renders below submit only when errors exist, receives programmatic focus after rejection, and links each message to the invalid control.

**Token / primitive mapping.** `FormMessage` / `FormError` / `FormErrorSummary` → `packages/design-system/README.md` → _Form layout standard_. On the invariant primary-blue surface, `FormMessage` / `FormError` use their semantic `tone="on-primary"` contract (`primary-surface-foreground`, full strength) rather than an app-level colour override.

**Rendered contract.** Showcase → Primitives → Field (invalid state) and Form → `FormErrorSummary` (linked, focusable long-form summary).

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

On the invariant primary-blue surface, `Link` uses its semantic
`tone="on-primary"` contract: full-strength `primary-surface-foreground` at
rest, underline on hover, the AA-safe `primary-surface-muted` active delta, and
the standard focus ring. Product pages do not override link child classes.

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
