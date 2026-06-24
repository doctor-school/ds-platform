# @ds/design-system

## 0.2.0

### Minor Changes

- [#287](https://github.com/doctor-school/ds-platform/pull/287) [`0df9312`](https://github.com/doctor-school/ds-platform/commit/0df9312d3333e81d49039146e4b23c8ca8ac777a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(285): WCAG-AA contrast on the auth surfaces (ADR-0013 §7). The filled primary `Button` no longer paints `primary` (blue.500 #2D84F2 — white only 3.69:1). A new accessible action-fill triad carries it: `primary-action` (blue.700 #114D9E, white 8.14:1, resting) → `primary-hover` / `primary-pressed` (blue.800 #0D3A77, 11.12:1), so every state clears AA while keeping a visible resting→hover interaction delta ([#270](https://github.com/doctor-school/ds-platform/issues/270) L1/L3). `primary` stays blue.500 as the brand anchor (link text, focus ring, icons, tints). `muted-foreground` darkens neutral.500 → neutral.600 (on `muted` neutral.100: 4.31:1 → 6.77:1), fixing the inactive Tabs-trigger contrast. The L4 axe-core scan on `/login` `/register` `/reset` is now green and promoted WARN → BLOCK.

- [#268](https://github.com/doctor-school/ds-platform/pull/268) [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(237): rebuild the portal auth surfaces on the design system — the reference vertical slice. login / register / verify / reset are re-skinned onto tokens + blocks from `@ds/design-system`, wrapped in the new `AuthLayout` split-screen block (shadcn `login-03`, re-skinned to tokens) with the Doctor School brand applied (Inter, SVG wordmark logo). The brand panel uses the new AA-safe `primary-surface` token (blue.700 `#114D9E`, white 8.14:1) — `primary` (blue.500) only clears AA for large/bold text, so a colour panel carrying normal-weight copy uses `primary-surface` (ADR-0013 §7). Logos ship as SVG (ADR-0013 §8): the clean white variant sits directly on the panel (no `bg-card` chip), and the form-column logo is `lg:hidden` so there is exactly one logo per viewport. Passwordless OTP login now renders the `OtpFocusScreen` block once a code is requested — masked destination + auto-submit + resend-with-cooldown + change-method — closing the [#192](https://github.com/doctor-school/ds-platform/issues/192)/[#196](https://github.com/doctor-school/ds-platform/issues/196)/[#200](https://github.com/doctor-school/ds-platform/issues/200)/[#211](https://github.com/doctor-school/ds-platform/issues/211)/[#212](https://github.com/doctor-school/ds-platform/issues/212)/[#227](https://github.com/doctor-school/ds-platform/issues/227) papercut class. Masked destinations also applied to the verify/reset code steps. App glue (BFF `/v1/auth/*`, EARS-16 generic errors, i18n, auto-submit) is unchanged — only the presentation layer moved onto the system.

- [#278](https://github.com/doctor-school/ds-platform/pull/278) [`74508d6`](https://github.com/doctor-school/ds-platform/commit/74508d69d293fb3ca418dee638e4719f2fb7b7e7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(272): global interaction-state base-reset in `globals.css` `@layer base` (ADR-0013 §7 layer 1). Restores `cursor: pointer` for enabled interactive elements (`button`, `[role="button"]`, `summary`, `label[for]`, `select`) and `cursor: not-allowed` for `:disabled` / `[aria-disabled="true"]` — fixing the Tailwind v4 Preflight regression that dropped the v3 `button { cursor: pointer }` reset — and adds a `@media (prefers-reduced-motion: reduce)` guard that neutralises transitions/animations platform-wide. One place; covers every current, future, and third-party element, so no component class needs to repeat it.

- [#281](https://github.com/doctor-school/ds-platform/pull/281) [`8b986ff`](https://github.com/doctor-school/ds-platform/commit/8b986ffcad8e39e592c3be5db4c565211c18d185) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(273): interaction-state contract on primitives (ADR-0013 §7 layer 2). A shared `interactiveBase` fragment (focus-visible ring + colour transition + disabled dim, token-only) is now composed into `Button`, `Input`, and `TabsTrigger` so the contract travels with the component. `Button` gains an `active:` press state per variant and a `loading` prop (renders a spinner, sets `aria-busy`, and blocks interaction; `asChild` keeps its single-child Slot contract and only forwards `aria-busy`). `TabsTrigger` gains a hover affordance on inactive tabs. `interactiveBase` is exported for app-authored interactive elements. Layer 1 ([#272](https://github.com/doctor-school/ds-platform/issues/272)) still owns cursor + `prefers-reduced-motion` globally.

### Patch Changes

- [#289](https://github.com/doctor-school/ds-platform/pull/289) [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(237): brand panel left / form right — the recorded column-order decision. The `AuthLayout` split-screen shipped with the inherited shadcn `login-03` default (form-left / panel-right), but the [#237](https://github.com/doctor-school/ds-platform/issues/237) settled product-owner decision is brand-panel LEFT, form RIGHT. The form column stays first in source order (a11y — the interactive surface precedes the decorative panel) and is flipped visually on `lg+` via `lg:order-2` (panel `lg:order-1`); the `< lg` single-column layout (panel hidden, form fills) is unchanged.

## 0.1.0

### Minor Changes

- [#114](https://github.com/doctor-school/ds-platform/pull/114) [`0feefc5`](https://github.com/doctor-school/ds-platform/commit/0feefc5a37768db4f03042688b22b64908a449c9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(frontend): scaffold apps/portal + graduate packages/design-system (auth-form set)

  Graduates `@ds/design-system` from a stub to the Tailwind CSS 4 + shadcn/ui
  owned-code component set the 003 inline auth forms need (ADR-0004 §6): a single
  token sheet (`globals.css`) whose one `--radius` derives the whole radius scale
  via `@theme inline`, plus `Button`, `Input`, `Label`, `Card`, the RHF `<Form>`
  binding (ADR-0004 §9), and `InputOTP`. Components ship as source and are
  transpiled by consumers (`transpilePackages`).

  Scaffolds `@ds/portal` as a Next.js 16 App Router app (`output: 'standalone'`,
  no Vercel runtime — ADR-0004 §2.3/§3/§7): app shell + a sign-in page wiring the
  RHF + `@hookform/resolvers/zod` + `<Form>` + `<InputOTP>` stack end to end. The
  BFF calls and the OIDC silent-re-auth middleware land with feature 003. Closes
  [#82](https://github.com/doctor-school/ds-platform/issues/82).
