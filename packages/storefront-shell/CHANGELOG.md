# @ds/storefront-shell

## 0.2.0

### Minor Changes

- [#2198](https://github.com/doctor-school/ds-platform/pull/2198) [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One shared storefront shell for both storefronts ([#2180](https://github.com/doctor-school/ds-platform/issues/2180)). The topbar, header,
  footer and theme control now live in `@ds/storefront-shell`, built from the
  owner-approved `design-source/ds-shell.dc.html` canvas, and each host supplies
  values only: a `lib/shell-config.ts` config object and an `auth: ShellAuthState`
  DATA prop it maps its own session onto — the cluster's markup, geometry and press
  chain are the package's, so neither host can draw its own chip. The Doctor showcase mounts the pair from its `(storefront)` layout; the
  Academy mounts the header through its three `@chrome` slots and the footer —
  new to that host, 008 EARS-14 — from the root layout. The six host twins
  (`app-shell-header`, `header-user-cluster`, `storefront-header`,
  `storefront-footer`, and both `theme-toggle` copies) are deleted, closing the
  2026-09-03 duplicated-theme-toggle debt line.

  `minor` on all four: `@ds/storefront-shell` is net-new to `main` (additive),
  both apps gain shell surface rather than losing a capability, and
  `@ds/design-system` gains five additive tokens for the canvas-exact chrome —
  `--font-size-topbar` / `--font-letter-spacing-topbar` (the 9px / .22em BBM
  micro-band), `--container-search` (the 440px desktop search cap) and
  `--font-size-chip` / `--spacing-chip-x` (the 13.5px / 22px header-chip geometry).
  The `on-primary` Button variant IS that chip now: it absorbs the deleted
  `HEADER_CHIP_BASE` constant, loses its `border-2` (the canvas paints none) and
  gains the `chip` and `avatar` sizes, so the chip changes in ONE place for both
  storefronts. Every other `on-primary` call site loses the border with it. Three
  visible deltas ride along — the storefront footer appears on every non-auth,
  non-room Academy route; the guest control is the ONE «Войти / Регистрация»
  chip of the canvas on BOTH hosts (the Academy label was «Войти», the Doctor
  showcase drew a «Войти» + «Регистрация» pair), one cluster at every width
  instead of a separate entry inside the mobile `≡` menu (017 EARS-1 forbids a
  second cluster in the DOM); the Doctor header search stops at the canvas cap
  instead of spanning the bar; and the BBM topbar's micro type moves onto the band
  itself, so its text is centred in the band rather than riding the body's
  line-height strut.

  The BBM topbar keeps the contrast the canvas paints; that is an owner-accepted
  a11y exception recorded as Issue [#2189](https://github.com/doctor-school/ds-platform/issues/2189) and carried in the e2e axe scans as a
  single leaf-scoped node exclusion.

  The chrome's look lives in the primitives, not at the shell's call sites:
  `@ds/design-system` gains `Input variant="header"` (the navy-band search field),
  `Link` `tone="header-nav" | "neutral"`, `variant="wrapper" | "mobile-nav-row"`,
  `size="sm"` and `weight="strong"`, `Button tone="header"`, and a new
  `DisclosureSummary` primitive (the `≡` control as the on-header chip). Every
  value is the canvas value, moved — the rendered result is unchanged — and the
  four shell files are consequently NOT on the `local/no-primitive-style-override`
  legacy baseline, which now stands at 143 hits across 23 files.

### Patch Changes

- [#2247](https://github.com/doctor-school/ds-platform/pull/2247) [`5ef3dfe`](https://github.com/doctor-school/ds-platform/commit/5ef3dfe8f25ced62cf58270cc93f3a52341fc523) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The Academy's signed-in header carries «Мои события» again ([#2243](https://github.com/doctor-school/ds-platform/issues/2243), 008
  EARS-5/11). The canvas draws the link inside the auth cluster
  (`design-source/ds-shell.dc.html`, `user.links` line 209, rendered at line 33 on
  desktop and as an `≡` row at line 50); it was lost when the Academy moved onto
  the shared chrome in [#2198](https://github.com/doctor-school/ds-platform/issues/2198), because the owner's 2026-09-10 «Эфиры alone»
  decision — which is about the TOP NAV — was read as if it covered the cluster
  too.

  `ShellAuthState`'s signed-in branch gains an optional `links: ShellLink[]`, so
  the destination is a host VALUE like every other difference between the two
  storefronts: the Academy passes «Мои события» → `/account/events`, the Doctor
  showcase passes none (canvas `user.links` line 192 is empty) and its cluster is
  unchanged, byte for byte. The package decides where the link is drawn at each
  width — beside the chip on desktop, as a row after the nav rows in the `≡`
  menu — so exactly one auth cluster still reaches the DOM (017 EARS-1). The top
  nav is untouched on both hosts.

  `apps/portal/lib/navigation-model.ts` gains the matching row, so the derived
  navigation walk visits `/account/events` as the golden signed-in doctor.

- [#2282](https://github.com/doctor-school/ds-platform/pull/2282) [`1d24fe5`](https://github.com/doctor-school/ds-platform/commit/1d24fe59329d5dcf968229901e64b577dbf0ca0c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The Academy header reads the doctor's session on the server ([#2281](https://github.com/doctor-school/ds-platform/issues/2281)): the page
  arrives with the right auth cluster already drawn — «Войти / Регистрация» for a
  guest, «Мои события» and the profile chip for a signed-in doctor — instead of
  painting the guest cluster first and swapping after a client fetch.
  `apps/portal/lib/shell-auth.ts` resolves the shell's `auth` prop through
  `@ds/auth-flow/server` (one session read, plus one self-profile read for the
  initials chip); the client leaf `academy-shell-header-client.tsx` is gone.

  `@ds/storefront-shell` drops the `refreshShellAuth` client signal and its
  module: nothing needs it once the header is a server render. After login,
  verify, reset and logout the flow navigates, which renders the header anew;
  saving the profile name calls `router.refresh()` so the chip initials update
  in place. `/`, `/documents` and `/documents/[slug]` become dynamic routes,
  because their header now depends on the request's cookie.

- [#2239](https://github.com/doctor-school/ds-platform/pull/2239) [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One server auth read for both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1). The
  session cookie, the authenticated SSR read with its ADR-0001 §6 fingerprint
  headers, the signed-in guard on the auth screens and the `returnTo` parking
  rule move out of `apps/portal/lib/{header-auth,return-to-origin,use-redirect-if-authenticated}.ts`
  and `apps/doctor/lib/{session,shell-auth}.ts` into `@ds/auth-flow/server`. Each
  host keeps only its own route values (`lib/auth-flow-routes.ts`): which paths
  are its auth screens, which of them a signed-in user may still complete, and —
  on the Academy — the cookie the middleware parks a return target in.
  `@ds/auth-flow/server` re-exports the session declaration that stays owned by
  `@ds/events-storefront/server`, so the cookie name and the fingerprint surface
  exist once in the repo and auth consumers read them from one address.

  Two user-visible deltas ride along. The doctor storefront's `/register` gains
  the signed-in guard it never had ([#675](https://github.com/doctor-school/ds-platform/issues/675) parity): a signed-in doctor opening it is
  sent on instead of being shown a registration form. And a doctor who is sent to
  `/login?returnTo=/account` now lands back on `/account` after signing in
  ([#1987](https://github.com/doctor-school/ds-platform/issues/1987)) instead of on the events landing — the Academy already did this; the
  `/account` landing shape now lives in the shared codec both hosts read.
  Everything else — the screens, their copy, the order of the steps — is
  unchanged on both storefronts.

- [#2236](https://github.com/doctor-school/ds-platform/pull/2236) [`37982db`](https://github.com/doctor-school/ds-platform/commit/37982dbaf703cfe17ce5f42e9035bec2dc1717f5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fit the giant footer wordmark to its box on both storefronts ([#2234](https://github.com/doctor-school/ds-platform/issues/2234)): the container-query coefficient each host carries is now derived from the measured glyph run of its own wordmark (`min(15.07cqw,240px)` for «Doctor.School», `min(8.76cqw,150px)` for «Academy.Doctor.School») instead of a hand-guessed one, so the run lands on the canvas's 96.5% of the footer box at every width. The old coefficients over-scaled the run by 2.4% (Doctor) and 5.7% (Academy) of the box — `overflow: hidden` clipped the tail of the word at EVERY viewport, which is what the owner hit on a 390px phone.
- Updated dependencies [[`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`e33baab`](https://github.com/doctor-school/ds-platform/commit/e33baab31e3f594a62470977270848e733a20fcc), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9)]:
  - @ds/design-system@5.5.0
