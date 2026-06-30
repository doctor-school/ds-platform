# @ds/design-system

## 0.5.0

### Minor Changes

- [#398](https://github.com/doctor-school/ds-platform/pull/398) [`25a22ca`](https://github.com/doctor-school/ds-platform/commit/25a22ca0b71961ce599cf8b891595d59736c87a6) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Submit/pending progress visualization across the auth surfaces ([#337](https://github.com/doctor-school/ds-platform/issues/337)). Every async
  submit now drives the shared `Button.loading` affordance from its in-flight flag
  (`loading={isSubmitting}`) instead of a static `disabled={isSubmitting}` — a
  determinate spinner + `aria-busy` + disabled-while-loading, so the surface reads as
  "working" instead of appearing to hang (the [#333](https://github.com/doctor-school/ds-platform/issues/333) Stage-B owner finding). Covers
  login (password + OTP request), register, reset (request + complete), verify, and the
  shared `<OtpFocusScreen>` block. `prefers-reduced-motion` and the double-submit guard
  are already satisfied by `Button.loading`. The standard is documented in ADR-0013 §7
  and enforced by a new `submit-pending` lint guard (WARN).

## 0.4.0

### Minor Changes

- [#336](https://github.com/doctor-school/ds-platform/pull/336) [`c7fa09f`](https://github.com/doctor-school/ds-platform/commit/c7fa09fc53432c338ec99aed8725d110a670cba3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-do the slice-B form error/hint/spacing/tab standard from live owner-reviewed defects ([#333](https://github.com/doctor-school/ds-platform/issues/333)), with research-backed **rendered options** picked by the product owner (Stage A).

  - **K-1 — over-spacing → inline message.** `FormMessage` no longer reserves a permanent `min-h-5` line under every field (the slice-B blank-line over-spacing); it renders **on demand** — the helper (muted) by default, swapping the error into its place on failure, and **nothing** at rest when there is neither. Error/helper text is `text-xs` (12 px) and **not bold**. Forms space fields with `space-y-4` (16 px) — larger than the in-field gap — so a message reads as belonging to **its** field, not the next one (proximity). Long forms (>3 fields) use an error-summary panel below submit (rule documented; `<FormErrorSummary>` deferred to the first such form).
  - **K-2 — glued tabs on hover → gap track.** `TabsList` gains a `gap-2` track between segments so an inactive segment's hover fill never butts flush against the active one (the slice-B hover-gluing).
  - **K-3 — "red mush" → mark the field.** Invalidity is carried by the input border + a destructive focus ring (`aria-invalid:border-destructive` / `aria-invalid:focus-visible:ring-destructive`) + the message; the **label stays neutral** (no more red label + red helper + red message).
  - Standard updated to match shipped reality: ADR-0013 §7 (Form layout & validation contract; segment-separation [#4](https://github.com/doctor-school/ds-platform/issues/4)) + the design-system README (`Form layout standard` + clickable matrix). Portal auth forms (`/login`, `/register`, `/reset`, `/verify`) adopt `space-y-4`. Live-verified on the dev stand across login (password + OTP), register, and verify.

- [#330](https://github.com/doctor-school/ds-platform/pull/330) [`e909b86`](https://github.com/doctor-school/ds-platform/commit/e909b861843e28dc0fee68e24f96774437bc39ea) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - OTP focus-resend on `/verify` and `/reset` code steps ([#227](https://github.com/doctor-school/ds-platform/issues/227), [#267](https://github.com/doctor-school/ds-platform/issues/267), EARS-24/25).

  - **`/verify`** — the existence-agnostic dual-affordance verify screen (enter the email code AND the co-equal «Войти» / «Сбросить пароль», EARS-24) now offers **resend-with-cooldown** wired to the real `POST /v1/auth/verify/resend` endpoint (EARS-25, [#319](https://github.com/doctor-school/ds-platform/issues/319)). A successful resend re-issues the code, restarts the 30s cooldown, and clears the stale typed code; the layout keeps both co-equal paths (it is NOT collapsed into the single-focus `OtpFocusScreen`). The resend control is hidden on a bare deep-link with no `?email=` destination to target. Auto-submit and the EARS-16 generic outcome are preserved.
  - **`/reset`** — the complete step (code + new password submitted together) gains a **resend-with-cooldown** wired to the existing `requestPasswordReset(identifier)` (no new backend) plus a **«Начать заново»** action that returns to the request step to change the identifier. The code+password-together shape is kept (no auto-submit, intentional).
  - **Bot-protection (EARS-17).** Both resend endpoints are `@BotProtected`, so each resend carries its own captcha token via `BotProtectionField` (renders nothing when no provider is configured — the dev default — so the guard short-circuits to ok). The `/verify` screen, which previously had no bot-protection field, now renders one for its resend.
  - **`@ds/portal`** — new `authClient.resendVerification` BFF helper and a `useResendCooldown` hook factoring the shared resend orchestration (nonce bump + clear-stale-code + error routing + success acknowledgement) across `/login`, `/verify`, `/reset`.
  - **Neutral, enumeration-safe resend confirmation ([#326](https://github.com/doctor-school/ds-platform/issues/326))** — a resend on `/verify` and `/reset` now shows a generic, identical-in-every-case `role="status"` confirmation (it previously re-armed the cooldown but acknowledged nothing — a "dead button"). The "account exists" fact is disclosed out-of-band by email, never on-screen (OWASP Authentication Cheat Sheet + WSTG account-enumeration; Clerk user-enumeration-protection); the confirmation is conditionally phrased and asserts nothing about account existence. UI-only — a resend sends no additional notice email.
  - **`@ds/design-system`** — new exported `useResendCountdown` hook factoring the live resend-cooldown timer; `OtpFocusScreen` now composes it, and the `/reset` inline resend (which can't adopt the whole block) reuses the identical timer instead of duplicating the interval logic.

  **Systemic auth-surface polish (live-review findings — apply to every auth surface, not just slice B):**

  - **`secondary` Button variant** redefined — the borderless light fill read as "disabled"; it now carries a resting border (parity with `outline`), a tonal fill, a brand-ring hover, and a darker active, so a secondary action (login OTP «Отправить код», verify «Войти») reads as clearly enabled/clickable.
  - **Form field layout (no reflow on error)** — `FormMessage` now always renders a reserved one-line slot (`min-h`, `aria-hidden` while empty), so showing/hiding a validation message no longer grows the form; `FormItem` uses a clearer label→control gap so the focus ring never touches the label.
  - **`OtpFocusScreen` resend label** uses `tabular-nums` so the countdown digits don't jitter as the seconds tick (also applied to the `/verify` and `/reset` inline resend labels).
  - **`/reset` complete step** — the «Начать заново» + resend footer is separated from the password field with a top border + spacing (was jammed against the input).

### Patch Changes

- Updated dependencies [[`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56)]:
  - @ds/schemas@0.8.0

## 0.3.0

### Minor Changes

- [#295](https://github.com/doctor-school/ds-platform/pull/295) [`8645614`](https://github.com/doctor-school/ds-platform/commit/8645614d9fe5dc194a65b619cb65ae58641309e4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(266): `OtpFocusScreen` gains a `resendNonce` prop that restarts the resend
  cooldown without a remount. The block previously re-seeded its countdown only
  when `cooldownSeconds` changed, so a resend re-issuing the same duration could
  not restart it — the portal login worked around this by remounting the verify
  form via `key={resendNonce}`. Consumers now bump `resendNonce` instead; the
  portal login drops the remount hack and clears the stale code explicitly on the
  same signal.

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
