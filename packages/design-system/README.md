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

| Export                     | Purpose                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `Button` (`./button`)      | `cva` variants — primary / outline / ghost / destructive / link                                   |
| `Input` (`./input`)        | Text/email/password field                                                                         |
| `Label` (`./label`)        | Radix label primitive                                                                             |
| `Card` (`./card`)          | `Card` + `Header`/`Title`/`Description`/`Content`/`Footer` — the auth-form shell                  |
| `Form` (`./form`)          | RHF binding — `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage` (ADR-0004 §9) |
| `InputOTP` (`./input-otp`) | One-time-code field for email-OTP / SMS-OTP (EARS-6/7)                                            |

Forms follow the ADR-0004 §9 pattern: **RHF + `@hookform/resolvers/zod` + shadcn
`<Form>`**, with the Zod schema imported from the SSOT (`@ds/schemas`, once the
auth schemas land in F1/F2). The resolver + schema live in the consuming app, not
here.

## Adding a component later

This package follows the shadcn **owned-code** convention: components are copied
in and edited locally (not an npm dependency). When a later vertical needs a new
primitive, add it under `src/components/`, give it a subpath in `exports`, and
re-export from `src/index.ts`. A Storybook is deferred (ADR-0004 OQ-F9: team ≥2
frontend or >20 components).
