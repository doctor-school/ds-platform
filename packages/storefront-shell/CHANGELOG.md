# @ds/storefront-shell

## 0.2.0

### Minor Changes

- [#2482](https://github.com/doctor-school/ds-platform/pull/2482) [`7f0019a`](https://github.com/doctor-school/ds-platform/commit/7f0019a99e5aa438e65e8b2bbcd6eee4d144d9b6) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Auth-flow mechanics are package constants, not host data ([#2443](https://github.com/doctor-school/ds-platform/issues/2443), owner
  2026-09-29: «механика работы auth-flow к этим различиям не относится»).

  `AuthFlowHostConfig` no longer accepts `channels` or `returnTo`, and
  `AuthFlowRoutes` no longer accepts `allowAuthenticated`. The package serves sign-in codes over
  `AUTH_FLOW_CHANNELS` (`["email", "sms"]`) on every storefront, and the signed-in
  guard derives its one exemption from the host's reset route
  (`authenticatedAllowedRoutes(routes)`, 003 EARS-28). `identifierFieldSchema()`,
  `loginIdentifierFormSchema()` and `otpIdentifierFormSchema(channel)` no longer
  take a host config. Both host configs drop the keys; those values are unchanged.

  Return-target parking (014 EARS-6) is one package mechanism on both
  storefronts: `RETURN_TARGET_PARKING` (`ds_return_to`, 900 s, host-only), written
  by `parkReturnTarget(request, response?)` and read by the client store with no
  host argument. The Academy middleware and the doctor proxy both park on
  `/login`, `/register` and `/verify`. Behaviour change on the doctor storefront:
  an auth hop that lost the `returnTo` query param now lands on the parked target
  there too, as it already did on the Academy; the query param still wins when
  present. `parkReturnTarget` parks for a guest only - a request carrying the session
  cookie parks nothing - so the post-sign-in router prefetch of
  `/register?returnTo=...` no longer re-parks a target the success handler has
  already consumed (fixes a stale landing on a later plain `/login`,
  pre-existing on the Academy).

  The package also exports `AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS` — the fields that
  may differ per storefront (`register.promoField`, `landing.specialtyAware`,
  `consents`), each naming the clauses of its row in 021's new «Differences between
  storefronts» table.

  `@ds/storefront-shell` exports `SHELL_PRODUCT_DIFFERENCE_FIELDS` — the header
  `search`, cited in 017's new «Differences between storefronts» table.

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

- [#2493](https://github.com/doctor-school/ds-platform/pull/2493) [`972ccca`](https://github.com/doctor-school/ds-platform/commit/972ccca5d12e9bbe83f2be7c0c4ca90aa9401e9e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The header «Войти / Регистрация» brings the visitor back to the event page and
  never registers them ([#2487](https://github.com/doctor-school/ds-platform/issues/2487)): on both storefronts, on an event page the guest
  link carries that page as a land-only return — the page plus the fixed
  `?intent=land` marker, one shape in `@ds/schemas`
  (`formatLandOnlyReturnTarget` / `parseLandOnlyReturnTarget`). The doors carry it
  end-to-end (the same-origin guard keeps exactly this marker, so the parking
  cookie keeps it too) and the shared completion lands on the page without
  `RegisterForEvent`. The event page's own registration button is unchanged. Home,
  feeds and the auth doors keep the bare route.
- Updated dependencies [[`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14), [`247b352`](https://github.com/doctor-school/ds-platform/commit/247b3524c9addd7e7ebf83a19ac8615a79b3e306), [`c754a6d`](https://github.com/doctor-school/ds-platform/commit/c754a6d5a11e8d72ef26d7cc756cc26cafda3977), [`ed94b36`](https://github.com/doctor-school/ds-platform/commit/ed94b36260d4ef98d16a9d8f0f1e1bdbd33c8449), [`dbc5624`](https://github.com/doctor-school/ds-platform/commit/dbc5624ef3cacf00d7fb60119f5045248fe22299), [`87e7143`](https://github.com/doctor-school/ds-platform/commit/87e7143dd89b7d6d9942f7008f92c64899dd8431), [`1853c46`](https://github.com/doctor-school/ds-platform/commit/1853c46b619aa78d69e4da96c6d5e1a7a02d517d), [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`096f73f`](https://github.com/doctor-school/ds-platform/commit/096f73ff412db2ac636cd04cb624209e7613da93), [`b1e5396`](https://github.com/doctor-school/ds-platform/commit/b1e5396f7a3516895a1e1dcd10a7fd62090d9f61), [`a4c37d2`](https://github.com/doctor-school/ds-platform/commit/a4c37d24812727cbfad64cd969446b0ee234848a), [`e26551d`](https://github.com/doctor-school/ds-platform/commit/e26551d777b683079f7dbed7f68e9ab8475a4508), [`7bb7040`](https://github.com/doctor-school/ds-platform/commit/7bb7040046f9ee2f2f4f0b3c007918bc9d2cba84), [`3ae7607`](https://github.com/doctor-school/ds-platform/commit/3ae7607a52c1143dcd1fae78b854ce627cf94b6b), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`026327e`](https://github.com/doctor-school/ds-platform/commit/026327eb09f34c722b68a6a50e0e2b4a3018003c), [`e33baab`](https://github.com/doctor-school/ds-platform/commit/e33baab31e3f594a62470977270848e733a20fcc), [`103c74d`](https://github.com/doctor-school/ds-platform/commit/103c74deb7f6e51c0467c520ebfd1813272000bb), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`5912916`](https://github.com/doctor-school/ds-platform/commit/5912916deaab5efea847a94fada3f0ea232634b1), [`972ccca`](https://github.com/doctor-school/ds-platform/commit/972ccca5d12e9bbe83f2be7c0c4ca90aa9401e9e), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9)]:
  - @ds/design-system@5.5.0
  - @ds/schemas@7.0.0
