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

| Export                     | Purpose                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (`./button`)      | `cva` variants — primary / outline / ghost / destructive / link                                                                                          |
| `Link` (`./link`)          | Nav/footer link — `interactiveBase` ring + `link` state row; `standalone` (no resting underline) / `inline` variants, `asChild` wraps `next/link` (#324) |
| `Input` (`./input`)        | Text/email/password field                                                                                                                                |
| `Label` (`./label`)        | Radix label primitive                                                                                                                                    |
| `Card` (`./card`)          | `Card` + `Header`/`Title`/`Description`/`Content`/`Footer` — the auth-form shell                                                                         |
| `Form` (`./form`)          | RHF binding — `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage` + `FormError` (form-level submit error) (ADR-0004 §9)                |
| `InputOTP` (`./input-otp`) | One-time-code field for email-OTP / SMS-OTP (EARS-6/7)                                                                                                   |

Forms follow the ADR-0004 §9 pattern: **RHF + `@hookform/resolvers/zod` + shadcn
`<Form>`**, with the Zod schema imported from the SSOT (`@ds/schemas`, once the
auth schemas land in F1/F2). The resolver + schema live in the consuming app, not
here.

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

## Form layout standard (ADR-0013 §7)

Form vertical rhythm and validation messaging are a **contract**, not per-screen
care — tight resting rhythm, no over-spacing, and an error that reads as part of
**its** field. These are the concrete token-only classes `#333` implements against
(rationale + research citations in ADR-0013 §7 → _Form layout & validation
contract_). **Token-only: no arbitrary `[...]` values** — every class below
resolves to an existing scale token (the §5 / `#269` arbitrary-value guard must
stay green).

| Concern              | Value                                                                         | Notes                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label ↔ control gap  | `flex flex-col gap-2.5` (10 px)                                               | `FormItem` inner gap; `2.5` not `1.5` so the control's `interactiveBase` `focus-visible:ring-2 ring-offset-2` (~4 px above the input) does not touch the label on focus (ring-clearance, #227/#267 live-proven)           |
| Field-group spacing  | `space-y-4` (16 px)                                                           | set on the `<form>` / fields wrapper, **not** the `FormItem`; **larger** than the 10 px in-field gap so an on-demand message stays closer to its own field than to the next field's label (proximity, #333 owner finding) |
| Field height         | `h-9`                                                                         | `Input` / single-line controls (matches `Button` default)                                                                                                                                                                 |
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
never fires mid-typing. Long forms (**>3 fields**) use a `<FormErrorSummary>`
panel **below the submit button** instead (deferred until the first such form).

**One error-style source.** The error look (`text-xs text-destructive`,
`role="alert"`) lives in **one place** — `FormMessage` (field-level) and
`FormError` (form-level submit/auth error, e.g. the EARS-16 generic outcome) both
compose the shared tone constants in `form.tsx`. A page renders
`<FormError>{error}</FormError>`, **never** a hand-typed raw `<p role="alert"
className="…">` — duplicating the error style per screen is the #333 Stage-B
finding the design system exists to prevent.

```
FormItem            → flex flex-col gap-2.5  (label ↔ control, tight + ring-clearing)
  FormLabel                                  (neutral on error — no text-destructive)
  FormControl        → Input h-9             (aria-invalid → destructive border + ring)
  FormMessage        → text-xs, on demand    (helper muted; error swaps in place; null when empty)
<form> / fields      → space-y-4             (16 px — message hugs its field, not the next)
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
| `Button` secondary   | `bg-secondary text-secondary-foreground` **`border border-input`** `shadow-sm`                     | `hover:border-ring hover:bg-secondary/70`                                                  | `active:bg-secondary/60`        | same                                                                  |
| `Button` outline     | `border border-input bg-background shadow-sm`                                                      | `hover:bg-accent hover:text-accent-foreground`                                             | `active:bg-accent/80`           | same                                                                  |
| `Button` ghost       | —                                                                                                  | `hover:bg-accent hover:text-accent-foreground`                                             | `active:bg-accent/80`           | same                                                                  |
| `Link` / `link`      | `text-primary-action` (blue.700, AA on white; no underline)                                        | `hover:underline underline-offset-4`                                                       | `active:text-primary-action/80` | `disabled:opacity-50` + L1 `not-allowed`                              |
| `TabsTrigger`        | inactive `text-foreground/60` `px-3 py-1`; `TabsList` **`gap-2` track**                            | `data-[state=inactive]:hover:bg-background/50 data-[state=inactive]:hover:text-foreground` | —                               | `disabled:opacity-50`                                                 |
| `TabsTrigger` active | `data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow` | —                                                                                          | —                               | —                                                                     |

- **Disabled vs secondary (#2):** secondary is told apart from disabled by a
  **`border border-input` + pointer cursor + live hover**, never by fill depth.
  Disabled is the **combination** `opacity-50` + L1 `cursor: not-allowed` +
  `pointer-events-none` — dimmed _and_ inert _and_ not-allowed cursor.
- **Link (#3):** the new `Link` primitive composes `interactiveBase` (focus ring)
  - `text-primary-action hover:underline underline-offset-4 active:text-primary-action/80`; no
    resting underline on standalone nav links, resting underline on in-body links.
- **Segment separation (#4, redone in #333):** `TabsList` carries a `gap-2` track
  between segments so an inactive segment's `hover:bg-background/50` never butts
  flush against the active segment (the slice-B hover-gluing defect, K-2). The
  transparent-border-only inset was not enough — the gap is the fix.

## Adding a component later

This package follows the shadcn **owned-code** convention: components are copied
in and edited locally (not an npm dependency). When a later vertical needs a new
primitive, add it under `src/components/`, give it a subpath in `exports`, and
re-export from `src/index.ts`. A Storybook is deferred (ADR-0004 OQ-F9: team ≥2
frontend or >20 components).
