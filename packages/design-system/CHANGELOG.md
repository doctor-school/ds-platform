# @ds/design-system

## 0.6.0

### Minor Changes

- [#536](https://github.com/doctor-school/ds-platform/pull/536) [`8ae9f6f`](https://github.com/doctor-school/ds-platform/commit/8ae9f6f448896e6aca92f24cee2264dc95bbf796) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Emit a `.light` forced-light theme reset alongside `.dark`. `:root` declares the light theme document-wide but cannot reset a subtree nested inside a `.dark` ancestor (CSS custom properties inherit), so a region that must stay light under a dark page had no affordance. The token build now also writes the light semantic colour roles under an explicit `.light` class — the mirror of `.dark` — so any subtree can pin light regardless of an ancestor theme. Additive (no token values change); enables the showcase's runtime page-level theme toggle to keep its light/dark specimen pairs side-by-side, and gives product apps a forced-light island (e.g. a print preview) for free.

- [#531](https://github.com/doctor-school/ds-platform/pull/531) [`2e95bcd`](https://github.com/doctor-school/ds-platform/commit/2e95bcd2892b4fe56895d5561a0980b9aaf75a69) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the §09 «Раскладка и ритм» layout & spatial-rhythm system to `@ds/design-system` (source `design-source/design-system.dc.html` §09 + §03). Space is now composed by semantic **ROLE**, not by eye:

  - **Container** primitive (`./container`, `content` | `calendar` variants) — centres the content column, caps it (1104px / 1240px), and owns the responsive gutter + breakpoint: at/above the new `layout` breakpoint (901px) the cap engages with a `clamp(16px, 4vw, 48px)` gutter; below it the column goes edge-to-edge on a fixed 16px gutter so day-band plates and cards can bleed.
  - **Semantic spacing-role tokens** over the §03 4px scale, surfaced as named Tailwind utilities via the `--spacing-<role>` `@theme` namespace: `inset` (`p-inset`), `stack` (20px mobile / 28px desktop — `space-y-stack-sm layout:space-y-stack`), `section` (48px desktop / 32px `section-sm` between mobile day groups — mobile rhythm = 20 intra-day / 32 between days is a recorded owner Stage-B decision, 2026-07-06, superseding the canvas's flush mobile gaps), `controls` (`gap-controls`), `inline` (`gap-inline`), `gutter` (`px-gutter` / `-mx-gutter` bleed), `day-band` (0 / bleed).
  - **Tokens:** `container.content`/`container.calendar` (→ `max-w-content` / `max-w-calendar`), the `breakpoint.layout` threshold, and the `semantic.space.*` role group; plus the webinar-card canvas dimensions — `font.size.eyebrow` (11px, `text-eyebrow`), `font.size.title-lg` (24px listing-card title, `text-title-lg`), `webinar-card.time-plate` (196px time plate, `w-time-plate`) and the `tracking-numeric` utility (−.04em tabular-time tracking). `tokens.css` + `allowed-tokens.json` regenerated (tokens-fresh idempotent).

  Token-only, square, both themes. Documented in the package README (Layout & spatial rhythm §09); the showcase gains a live **Layout & rhythm** composition rebuilt element-by-element from the vendored `webinar-card.dc.html` + `webinars-listing.dc.html` canvases — desktop bordered cards with the 196px time plate and blue offset casts, mobile flat full-bleed cards separated by their tint plates, both breakpoints × both themes.

- [#521](https://github.com/doctor-school/ds-platform/pull/521) [`42ce21f`](https://github.com/doctor-school/ds-platform/commit/42ce21f6999cea3f784d5d051cb53ce43dbd2031) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Codify the neo-brutalist visual language into the DTCG token SoT. Structural repaint of the design tokens: **radius 0** (flat, non-rounded system — the Tailwind `rounded-*` ladder collapses onto `--radius-control`), **hard offset shadows** (blur-0, theme-aware cast tones via the new `elevation`/`elevation-soft` roles), a **hard structural `border`** (near-black outline) split from a subtle `hairline` divider, the **amber `warning`** family with dark-ink foreground (white fails AA on amber), an expanded type scale (kegel 10–56) with an `extrabold` (800) weight, role-named letter-spacing, and a `micro-label` eyebrow composite. The AA action-fill triad (`primary-action`/`primary-hover`/`primary-pressed`) and brand `primary` anchor are preserved. Tokens only — no consumer wired.

- [#530](https://github.com/doctor-school/ds-platform/pull/530) [`d7327b4`](https://github.com/doctor-school/ds-platform/commit/d7327b440490d50e8e146b6649e6778f18b01cf9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the nine new-language primitives to `@ds/design-system` (source `design-source/design-system.dc.html` §05–§08): **FilterChip** (interactive `aria-pressed` toggle), **Badge** (`live` pulsing indicator + `label`/`speaker` tint tags), **Avatar** (square initials, two fills), **Checkbox** / **Radio** / **Switch** (real native controls — keyboard + focus native — behind styled 22×22 / round / 46×26 visuals with the flush 3px focus ring), **Alert** (info/success/warn/danger callouts with `role=status|alert`), **Skeleton** (composable pulsing loader), and **DayBand** (full-bleed section plate). Adds the supporting semantic tokens (`info`, `live`/`live-foreground`, `success-tint`, `warning-tint`, `chip-border`), a `tracking-micro` utility, and the `live-pulse` animation (`animate-live-pulse` / `animate-skeleton-pulse`). Token-only, square, both themes; the danger/live red is the source's invariant `#C81E1E` in both themes (not the theme-flipping `destructive`).

- [#538](https://github.com/doctor-school/ds-platform/pull/538) [`3812ebb`](https://github.com/doctor-school/ds-platform/commit/3812ebb910ff24efc7012b3e44cdf0b477f29e53) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the auth blocks to the neo-brutalist language ([#517](https://github.com/doctor-school/ds-platform/issues/517)). `AuthCard` now promotes
  its `icon` into a square tint badge tile above an up-scaled, heavy title (canvas
  `auth-card` unit); `AuthLayout` collapses its split-shell at the semantic `layout`
  breakpoint (≥901px, §09 — the token match for the canvas ≤900px fold) instead of the
  generic `lg`. `OtpFocusScreen` inherits the neo-brutalist slots/buttons from its
  already-re-skinned primitives ([#512](https://github.com/doctor-school/ds-platform/issues/512)). Adds the semantic `primary-surface-foreground`
  token (white in BOTH themes) and repaints the `AuthLayout` brand panel with it — the
  action-pair `primary-foreground` repoints to dark ink in `.dark`, which rendered the
  dark-theme panel unreadable; the mispairing is now caught statically by
  `aa-contrast-lint`. Purely visual — no public prop changed and no behaviour touched
  (form logic, resend cooldown, masked destination all unchanged).

- [#528](https://github.com/doctor-school/ds-platform/pull/528) [`c58320b`](https://github.com/doctor-school/ds-platform/commit/c58320b97509472f15fbc5e73406ba758855e76d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the core interactive primitives to the neo-brutalist visual language (button, input, label, link, tabs, form, card, input-otp, and the `fields/*` composites). Built from the vendored canvas fidelity SoT (`design-source/design-system.dc.html`): square corners (radius 0), a hard 2px structural border, and hard offset shadows (blur-0) whose **cast colour is per-variant** — a filled action casts in the ink `border` tone, a bordered surface casts in the soft `elevation-soft` tone (new component-shadow tokens, since `--shadow-md` bakes the blue `elevation` cast). Interaction: hover translates `(2px,2px)` as the offset shrinks, press translates `(4px,4px)` as it collapses, focus adds the 3px ring alongside. Tabs become a segmented control; the card sits on the 6px elevation cast; OTP slots are 40px squares (hairline → ink border when filled); the inline form error takes the source's `⚠` + weight-700 danger tone. Both themes. No API change — visual re-skin only.

### Patch Changes

- [#546](https://github.com/doctor-school/ds-platform/pull/546) [`2dbd927`](https://github.com/doctor-school/ds-platform/commit/2dbd927442738b81d533492563482da36a811b93) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the OTP slot row overflowing a narrow card body ([#544](https://github.com/doctor-school/ds-platform/issues/544)). `InputOTPGroup` and each
  `InputOTPSlot` now carry `min-w-0`, and the slot is an `aspect-square` cell with a
  preferred `w-10` width (the approved [#512](https://github.com/doctor-school/ds-platform/issues/512) deviation from the canvas 42×52 wrapped
  inputs): the 8-slot login row shrinks to fit at 390px instead of overflowing the page
  body by ~30px, while wide layouts — including 6-slot verify/reset rows and multi-group
  compositions with a separator — keep the unchanged 40px square cell and their existing
  geometry. Both themes; neo-brutalist contiguous shared-border look preserved.

- [#543](https://github.com/doctor-school/ds-platform/pull/543) [`63e72ce`](https://github.com/doctor-school/ds-platform/commit/63e72ce6667e233eb05e3733a73778f31a216298) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the resend-cooldown row overflowing the auth card frame ([#542](https://github.com/doctor-school/ds-platform/issues/542)). The `Button` base carries `whitespace-nowrap`, so the longer verify/reset resend copy («Отправить повторно можно через N с») could neither wrap nor shrink in the `justify-between` row and pushed past the card's right border (owner-reported on /reset). Two changes: (1) the verify + reset resend copy now matches the canvas canonical form the login OTP screen already uses — «Отправить снова» / «Отправить снова · N с»; (2) the resend control on the shared `<OtpFocusScreen>` block and the inline reset/verify rows gains `min-w-0 whitespace-normal text-right` (with `shrink-0` on the neighbouring change-method / start-over control) so the cooldown label wraps instead of overflowing at any width, both themes. Cooldown timing/logic unchanged.

## 0.5.2

### Patch Changes

- Updated dependencies [[`88514b6`](https://github.com/doctor-school/ds-platform/commit/88514b60c93d47805dcc71539e84f89f8b2edda8)]:
  - @ds/schemas@0.9.0

## 0.5.1

### Patch Changes

- [#404](https://github.com/doctor-school/ds-platform/pull/404) [`18de7ef`](https://github.com/doctor-school/ds-platform/commit/18de7ef2a24bbbe5b69d73ca6a1837e864d53437) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the inactive `Tabs` trigger to use the AA-safe quiet tier `text-muted-foreground` (full strength) instead of an opacity-dimmed `text-foreground/60`. An opacity modifier on a foreground token drops it below the WCAG-AA contrast threshold ([#270](https://github.com/doctor-school/ds-platform/issues/270)); the muted-foreground token is the designated quiet-but-readable tier. Hover still resolves to full `text-foreground`. Surfaced by the new static `aa-contrast` guard ([#402](https://github.com/doctor-school/ds-platform/issues/402)) and confirmed AA-clean by the showcase axe scan ([#351](https://github.com/doctor-school/ds-platform/issues/351)).

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
