# `@ds/design-system`

Shared design system for the DS Platform web surfaces — **Tailwind CSS 4 tokens +
shadcn/ui owned-code components** (ADR-0004 §6). Consumed by every Next.js app
(`apps/portal`, later `apps/admin` / `apps/promo` / `apps/cms`).

This is the **graduation** of the package from a stub to the auth-form surface
that feature 003 (user authentication) needs — deliberately _only_ what the
inline auth forms require (issue #82 scope: "out — the full design system"). It
grows per later verticals.

## How it is consumed (no build step)

Components ship as **source `.tsx`**, not a compiled `dist/`. Apps transpile them
through Next's `transpilePackages: ['@ds/design-system']`. That keeps the
owned-code shadcn model intact — you edit the real component, not a vendored
copy — and avoids a publish/build cycle for an internal package.

```ts
import { Button } from "@ds/design-system/button";
import { Form, FormField, FormItem, FormControl } from "@ds/design-system/form";
import { NativeSelect } from "@ds/design-system/native-select";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@ds/design-system/input-otp";
```

Each component is a subpath export (see `package.json` `exports`); the barrel
`@ds/design-system` re-exports all of them.

## Tokens — one place, including `--radius`

`src/styles/globals.css` is the **single token source of truth**. An app pulls it
in once:

```css
/* apps/<app>/app/globals.css */
@import "@ds/design-system/globals.css";
```

`--radius` is declared **once** in `:root`. The `@theme inline` block derives the
whole radius scale (`--radius-sm|md|lg|xl`) from it via `calc()`, and every
component uses the resulting Tailwind `rounded-*` utilities. Change `--radius` in
this one file and every derived component re-rounds — the #82 acceptance
criterion. The same pattern carries the color tokens (`--primary`, `--border`,
`--ring`, …) and their `.dark` overrides.

The `@source "../components"` directive makes Tailwind scan these component
sources (through the workspace symlink) so their utility classes are emitted in
the consuming app's CSS even though they live outside the app tree.

## Component set (003 auth forms)

| Export                              | Purpose                                                                                                                                                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (`./button`)               | `cva` variants — primary / on-primary / outline / ghost / destructive / link                                                                                                                                                                                                      |
| `Link` (`./link`)                   | Nav/footer link — `standalone` / `inline`, semantic `tone="on-primary"`, full interaction states, and `asChild` routing composition (#324)                                                                                                                                        |
| `Input` (`./input`)                 | Text/email/password field                                                                                                                                                                                                                                                         |
| `NativeSelect` (`./native-select`)  | Native single-select — official shadcn/ui composition, Input-parity shell, quiet decorative chevron, browser-owned keyboard/type-ahead/mobile picker semantics                                                                                                                    |
| `Label` (`./label`)                 | Radix label primitive                                                                                                                                                                                                                                                             |
| `Card` (`./card`)                   | `Card` + `Header`/`Title`/`Description`/`Content`/`Footer` — the auth-form shell                                                                                                                                                                                                  |
| `Form` (`./form`)                   | RHF binding — field primitives, `FormError` (submit error), and focusable linked `FormErrorSummary` for long forms (>3 fields) (ADR-0004 §9; ADR-0013 §7)                                                                                                                         |
| `InputOTP` (`./input-otp`)          | One-time-code field for email-OTP / SMS-OTP (EARS-6/7)                                                                                                                                                                                                                            |
| `EventList` (`./blocks`)            | Controlled, fetch-free cross-front event feed — tabs, grouped webinar cards, empty state, and cursor-aware pagination; host apps own data and URL state                                                                                                                           |
| `LoginCard` (`./blocks`)            | Whole sign-in composition — `AuthCard` frame, password / one-time-code tabs, both forms, and the code-entry stage on `OtpFocusScreen`; one canonical block both storefronts project (#1666)                                                                                       |
| `PasswordRecoveryCard` (`./blocks`) | Whole password-recovery composition — stage-tracking `AuthCard` frame, the identifier request form, and the complete step submitting code + new password together with the shared resend cooldown; one canonical block both storefronts project (#1666)                           |
| `EmailConfirmCard` (`./blocks`)     | Whole post-registration confirmation composition — code entry with auto-submit, the server-confirmed success row, the resend control, and the two co-equal already-registered actions (never branches on account existence); one canonical block both storefronts project (#1666) |

Forms follow the ADR-0004 §9 pattern: **RHF + `@hookform/resolvers/zod` + shadcn
`<Form>`**, with the Zod schema imported from the SSOT (`@ds/schemas`, once the
auth schemas land in F1/F2). Field-tier components take a bound RHF field and own
nothing above it. Block-tier auth compositions (`LoginCard`,
`PasswordRecoveryCard`, `EmailConfirmCard`) own field
composition, the field-level schemas from `./fields`, and state presentation
(pending / error / stage); the host app owns copy, the validation resolver,
transport, routing and env.

### Surface-safe primary-surface contracts

Controls on the invariant `bg-primary-surface` blue request the semantic
`tone="on-primary"` contract instead of overriding child classes at the app
call-site. `Checkbox` applies full-strength `text-primary-surface-foreground` to
its visible label (enabled and disabled); `FormMessage` and `FormError` apply the
same AA-safe foreground while preserving their existing glyph and weight.
`Link` uses that foreground at rest, keeps its underline/focus affordances, and
uses the AA-safe `primary-surface-muted` token for its active delta. Omit `tone`
(or pass `default`) everywhere else; the original
`text-foreground`/`text-destructive-text`/`text-primary-action` behavior remains
unchanged.

The raised action uses the variant API instead: `Button variant="on-primary"`.
It composes the existing invariant white-chip roles
(`bg-header-foreground text-header-chip-foreground shadow-header-chip`) so the
CTA remains white with navy text and a dark hard cast in both themes. Hover,
active, focus-visible, disabled, and `loading` behavior stay owned by `Button`.

## Interaction-state contract (ADR-0013 §7)

Interaction quality (cursor, hover, active, focus-visible, disabled, loading,
reduced-motion) is **guaranteed by a layered defence**, not the diligence of a
page author:

1. **Layer 1 — global base-reset** (`src/styles/globals.css` `@layer base`):
   restores `cursor: pointer` for enabled interactive elements / `not-allowed`
   for `:disabled`, plus a `prefers-reduced-motion` guard. Cursor is owned
   **here, once** — primitives never repeat it.
2. **Layer 2 — primitive contract**: each styled clickable composes the shared
   `interactiveBase` fragment (`./primitives/interactive-base.ts` — focus-visible
   ring + colour transition + disabled dim) and adds its own token-only `hover:`
   / `active:` feedback. `Button` and `TabsTrigger` are the reference impls.
3. **Layer 3 — static lint** (`pnpm lint:interaction-states`, CI job, #269):
   fails (WARN in Phase 0) if the layer-1 reset is deleted, if `interactiveBase`
   loses its focus ring, or if a styled clickable (`button` / `[role="button"]` /
   Radix `*.Trigger`) ships without a `hover:` affordance or a focus ring.

When you add a new clickable primitive, compose `interactiveBase` and declare a
token-only `hover:` state — the lint and the `build-ui-from-design-system`
live-verify audit both check for it. To opt a genuine exception out, mark it with
`/* interaction-states-ok: <reason> */`.

### Async-submit pending (`loading`, ADR-0013 §7 / #337)

Any submit whose handler **awaits a network call** drives `Button`'s `loading`
prop from the form's in-flight flag — **not** a bare `disabled`:

```tsx
// ✅ pending feedback: spinner + aria-busy + disabled-while-loading (one prop)
<Button type="submit" loading={form.formState.isSubmitting}>Войти</Button>

// ❌ static disabled — the surface "appears to hang", no progress signal (#337)
<Button type="submit" disabled={form.formState.isSubmitting}>Войти</Button>
```

`loading` renders the determinate spinner, sets `aria-busy`, **and** disables the
control while busy (so it is also the double-submit guard); the spin is neutralised
under `prefers-reduced-motion` by the layer-1 reset while `aria-busy` still
announces. `disabled` stays for **non-submit** controls gated by cooldown/validity
(resend, change-method). The `submit-pending` lint (`pnpm lint:submit-pending`, CI
job, WARN) flags a `type="submit"` disabled by an in-flight flag with no `loading`;
opt a genuine exception out with `/* submit-pending-ok: <reason> */`.

## Form layout standard (ADR-0013 §7)

Form vertical rhythm and validation messaging are a **contract**, not per-screen
care — tight resting rhythm, no over-spacing, and an error that reads as part of
**its** field. These are the concrete token-only classes `#333` implements against
(the decision is ADR-0013 §7; the rationale + research citations live in the
design constitution → _Field_ + _Error & validation display_). **Token-only: no
arbitrary `[...]` values** — every class below
resolves to an existing scale token (the §5 / `#269` arbitrary-value guard must
stay green).

| Concern              | Value                                                                         | Notes                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label ↔ control gap  | `flex flex-col gap-2.5` (10 px)                                               | `FormItem` inner gap; `2.5` not `1.5` so the control's `interactiveBase` `focus-visible:ring-2 ring-offset-2` (~4 px above the input) does not touch the label on focus (ring-clearance, #227/#267 live-proven)           |
| Field-group spacing  | `space-y-4` (16 px)                                                           | set on the `<form>` / fields wrapper, **not** the `FormItem`; **larger** than the 10 px in-field gap so an on-demand message stays closer to its own field than to the next field's label (proximity, #333 owner finding) |
| Field height         | `h-11`                                                                        | `Input` / `NativeSelect` single-line controls                                                                                                                                                                             |
| Message (inline)     | `text-xs` (12 px), rendered on demand                                         | **no reserved height** — renders only when there is a helper or an error; small and **not bold** (#333 owner finding)                                                                                                     |
| Helper (resting)     | `text-xs text-muted-foreground`                                               | shown by default; **omit `FormMessage` children** for a field with no helper → nothing renders at rest                                                                                                                    |
| Error (swap-in)      | `text-xs text-destructive` (`role=alert`)                                     | replaces the helper **in place**; the field's invalidity is also carried by the input border (below)                                                                                                                      |
| Input invalid        | `aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive` | error marks the **field** (border + ring), label stays **neutral** — no "red mush" (#333 K-3)                                                                                                                             |
| No helper + no error | render **nothing**                                                            | field stacks on the `space-y-4` rhythm; **never** a blank reserved line (the slice-B over-spacing, #333 K-1)                                                                                                              |

**Inline message (1A).** `FormMessage` returns `null` when it has neither a
helper (`children`) nor an error — a resting field reserves **no** blank line (the
slice-B `min-h-5` over-spacing, K-1). When present it shows the helper (muted) by
default and **swaps the error into its place** (`role="alert"`, destructive) on
failure — the two never coexist. The accepted cost is a small one-line downward
shift when an error appears; validation is **on blur** (`mode: onTouched`) so it
never fires mid-typing. Long forms (**>3 fields**) additionally render
`<FormErrorSummary>` **below the submit button**. Pass localized
`{ fieldId, message }` items in field order, hold its forwarded `HTMLDivElement`
ref, and call `ref.current?.focus()` after a rejected submit. The summary owns
`role="alert"`, `tabIndex={-1}`, its accessible heading, and native `#fieldId`
links that focus their target controls on activation; `errors={[]}` renders
nothing. App copy and validation wiring stay in the app.

**Native single-select.** `NativeSelect` is an owned adaptation of official
shadcn/ui `NativeSelect` (MIT). It remains a real `<select>` — the browser owns
keyboard arrows, type-ahead, form submission, and the mobile picker — with only a
pointer-inert, `aria-hidden` chevron layered above it. Its token-only shell matches
`Input`: `h-11 w-full border-2 bg-background px-3.5 py-3 pr-10 text-sm`; empty
uses `border-hairline text-muted-foreground`, filled uses
`border-border text-foreground`, hover uses `border-ring`, active uses
`border-primary-action bg-muted`, focus-visible uses
`border-ring shadow-focus`, invalid uses
`border-destructive bg-destructive-tint`, and disabled uses
`border-hairline bg-muted text-muted-foreground`. Use a disabled empty option as
the placeholder; never preselect a real answer in a required field.

**One error-style source.** The error look (`text-xs text-destructive`,
`role="alert"`) lives in **one place** — `FormMessage` (field-level) and
`FormError` (form-level submit/auth error, e.g. the EARS-16 generic outcome) both
compose the shared tone constants in `form.tsx`. A page renders
`<FormError>{error}</FormError>`, **never** a hand-typed raw `<p role="alert"
className="…">` — duplicating the error style per screen is the #333 Stage-B
finding the design system exists to prevent.

On `bg-primary-surface`, compose `tone="on-primary"` on `FormMessage` /
`FormError`; the primitive swaps only the semantic text colour to
`text-primary-surface-foreground`. Do not repeat a `className` override in the
page.

```
FormItem            → flex flex-col gap-2.5  (label ↔ control, tight + ring-clearing)
  FormLabel                                  (neutral on error — no text-destructive)
  FormControl        → Input / NativeSelect h-11 (aria-invalid → destructive border + tint)
  FormMessage        → text-xs, on demand    (helper muted; error swaps in place; null when empty)
<form> / fields      → space-y-4             (16 px — message hugs its field, not the next)
  submit button
  FormErrorSummary   → alert + linked errors (long forms only; programmatic focus target)
```

**Enforcement.** Two static guards keep this contract from silently regressing
(both WARN in Phase 0, fixture-tested in `@ds/lint-guard-tests`): `form-error`
(#339) flags a hand-typed `role="alert"` + `text-destructive` error block that
bypasses `FormError` / `FormMessage`; `form-rhythm` (#334) flags the three #333
defects — a `min-h-*` reserved blank line on a message (K-1), a duplicate
`formDescriptionId` (a `<FormDescription>` beside a `<FormMessage>`), and a
`text-destructive` label in the error state (K-3). Each takes a
`/* form-error-ok: */` / `/* form-rhythm-ok: */` reasoned opt-out.

### Clickable state matrix (the values for `#324`)

| Kind                 | Resting                                                                                            | Hover                                                                                      | Active                          | Disabled                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| `Button` default     | `bg-primary-action text-primary-foreground shadow`                                                 | `hover:bg-primary-hover`                                                                   | `active:bg-primary-pressed`     | `disabled:opacity-50 disabled:pointer-events-none` + L1 `not-allowed` |
| `Button` on-primary  | `bg-header-foreground text-header-chip-foreground shadow-header-chip`                              | `hover:shadow-header-chip-hover`                                                           | `active:shadow-none`            | same                                                                  |
| `Button` secondary   | `bg-secondary text-secondary-foreground` **`border border-input`** `shadow-sm`                     | `hover:border-ring hover:bg-secondary/70`                                                  | `active:bg-secondary/60`        | same                                                                  |
| `Button` outline     | `border border-input bg-background shadow-sm`                                                      | `hover:bg-accent hover:text-accent-foreground`                                             | `active:bg-accent/80`           | same                                                                  |
| `Button` ghost       | —                                                                                                  | `hover:bg-accent hover:text-accent-foreground`                                             | `active:bg-accent/80`           | same                                                                  |
| `Link` / `link`      | `text-primary-action` (blue.700, AA on white; no underline)                                        | `hover:underline underline-offset-4`                                                       | `active:text-primary-action/80` | `disabled:opacity-50` + L1 `not-allowed`                              |
| `TabsTrigger`        | inactive `text-foreground/60` `px-3 py-1`; `TabsList` **`gap-2` track**                            | `data-[state=inactive]:hover:bg-background/50 data-[state=inactive]:hover:text-foreground` | —                               | `disabled:opacity-50`                                                 |
| `TabsTrigger` active | `data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow` | —                                                                                          | —                               | —                                                                     |
| `DataTable` row/card | `bg-card text-foreground`                                                                          | `hover:bg-tint`                                                                            | `has-[:active]:bg-tint-pressed` | —                                                                     |

- **Disabled vs secondary (#2):** secondary is told apart from disabled by a
  **`border border-input` + pointer cursor + live hover**, never by fill depth.
  Disabled is the **combination** `opacity-50` + L1 `cursor: not-allowed` +
  `pointer-events-none` — dimmed _and_ inert _and_ not-allowed cursor.
- **Link (#3):** the new `Link` primitive composes `interactiveBase` (focus ring)
  - `text-primary-action hover:underline underline-offset-4 active:text-primary-action/80`; no
    resting underline on standalone nav links, resting underline on in-body links.
  - on `bg-primary-surface`, pass `tone="on-primary"` for
    `text-primary-surface-foreground active:text-primary-surface-muted`; the
    underline and `focus-visible:shadow-focus` contract is unchanged.
- **Segment separation (#4, redone in #333):** `TabsList` carries a `gap-2` track
  between segments so an inactive segment's `hover:bg-background/50` never butts
  flush against the active segment (the slice-B hover-gluing defect, K-2). The
  transparent-border-only inset was not enough — the gap is the fix.
- **DataTable row/card (#1578):** whole-record activation remains a real stretched
  link/button. The containing desktop row and mobile card react to that target's
  live `:active` state through `has-[:active]:bg-tint-pressed`: light blue.200 and
  dark blue.700, the owner-picked one-step continuation after `hover:bg-tint`.
  Press adds no boundary, movement, or focus shadow. In dark mode, the muted
  context lifts to `foreground` while pressed so normal-size copy remains AA-safe;
  keyboard focus keeps its separate `focus-within:shadow-focus` contract.

## Layout & spatial rhythm (source §09)

Space is composed by **semantic ROLE**, not by eye. Each role names _where_ a gap
belongs and resolves to a §03-scale value through a generated token, so every
surface stays in the same rhythm. The roles are DTCG tokens (`semantic.json`
`space.*`) surfaced as named Tailwind v4 spacing utilities via the
`--spacing-<role>` `@theme` namespace — `p-inset`, `gap-controls`, `space-y-section`,
`-mx-gutter`, … — exactly like `p-4`/`gap-2`, but token-named. **Token-only: reach
for the role utility, not a raw step, when the gap has a role.**

| Role       | Token / utility                         | Canonical | Source set                                                                                                                                                                                           | Where                                          |
| ---------- | --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `inset`    | `p-inset` (`--spacing-inset`)           | 24px      | 16 · 20 · 24 · 30                                                                                                                                                                                    | Padding INSIDE cards, panels, buttons          |
| `stack`    | `space-y-stack-sm layout:space-y-stack` | 20 → 28px | 20 моб · 28 десктоп — owner Stage-B decision 2026-07-06, supersedes canvas gap:0                                                                                                                     | Gap BETWEEN cards in a list                    |
| `section`  | `space-y-section` (`--spacing-section`) | 32 → 48px | 32 моб (`section-sm`) · 44 · 48 — owner Stage-B decision 2026-07-06 (extends the stack-sm override: mobile rhythm = 20 intra-day / 32 between days), supersedes the canvas's flush mobile day header | Rhythm BETWEEN meaning blocks / sections       |
| `controls` | `gap-controls` (`--spacing-controls`)   | 12px      | 8 · 10 · 12                                                                                                                                                                                          | Between chips, buttons, fields                 |
| `inline`   | `gap-inline` (`--spacing-inline`)       | 8px       | 6 · 8                                                                                                                                                                                                | Icon ↔ text, label ↔ value                     |
| `day-band` | `-mx-4 layout:-mx-gutter` (bleed)       | 0 (bleed) | —                                                                                                                                                                                                    | The day plate sits flush + bleeds to the edges |

The **responsive** roles compose with the `layout:` breakpoint variant. Mobile
rhythm is a recorded product-owner Stage-B decision (2026-07-06), superseding
the canvas's flush mobile treatment: `stack` narrows to `stack-sm` (20px)
between cards within a day (`space-y-stack-sm layout:space-y-stack`), and
`section` narrows to `section-sm` (32px) above the next day group
(`mt-section-sm layout:mt-0` on every group but the first) — 20 intra-day / 32
between days, while the day band itself stays flush (0) to its own first card.
The gutter switches from a fixed 16px to the clamp — owned for you by
`Container` (below).

### Container (`./container`)

The **content column**. It centres the page column, caps its width, and owns the
responsive gutter + breakpoint so surfaces never re-derive layout by eye:

```tsx
import { Container } from "@ds/design-system/container";

<Container>{/* content — capped 1104px, centred, clamp gutter */}</Container>
<Container variant="calendar">{/* wider calendar surfaces — 1240px content */}</Container>
```

- **`content`** (default) caps at **1104px** (`max-w-content`); **`calendar`** caps
  at **1336px border-box = 1240px of content** inside the 48px desktop-max gutter
  (`max-w-calendar` — the canvas content-box `main{max-width:1240px}` translated
  to Tailwind's border-box, #1080) — the `--container-*` tokens.
- **≥ 901px** (the `layout:` breakpoint, `--breakpoint-layout`) — the cap engages,
  the column centres (`mx-auto`), the gutter is `clamp(16px, 4vw, 48px)`
  (`px-gutter`), and the offset shadows sit clear of the viewport edge.
- **≤ 900px** — edge-to-edge: **no** max-width cap, a **fixed 16px** gutter (`px-4`).
  The fixed gutter is what lets a `DayBand` plate or a card bleed to the viewport
  edge cleanly (`-mx-4 layout:-mx-gutter`).

Baseline (source §09 «Hit-target»): interactive targets ≥ **44×44**, a **3px**
focus ring (`shadow-focus`), **AA** text contrast — all already carried by the
primitives' interaction contract above.

The live rhythm composition (Container + stack + section + day-band bleed, both
breakpoints × both themes) is the `apps/showcase` **Layout & rhythm** section.

## Adding a component later

This package follows the shadcn **owned-code** convention: components are copied
in and edited locally (not an npm dependency). When a later vertical needs a new
primitive, add it under `src/components/`, give it a subpath in `exports`, and
re-export from `src/index.ts`. A Storybook is deferred (ADR-0004 OQ-F9: team ≥2
frontend or >20 components).
