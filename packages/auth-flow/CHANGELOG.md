# @ds/auth-flow

## 0.2.0

### Minor Changes

- [#2229](https://github.com/doctor-school/ds-platform/pull/2229) [`1e9079e`](https://github.com/doctor-school/ds-platform/commit/1e9079e249f094046a38edadc50ae9b8ec709d6e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One auth core for both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1). The auth client,
  the error dictionary, the bot-protection composition and the field rules move
  out of `apps/portal/lib` and `apps/doctor/lib` into the new private package
  `@ds/auth-flow`, which each host mounts through a value file
  (`lib/auth-flow-config.ts`): the paths, the OTP channels, the captcha site key
  and every sentence a doctor reads stay the host's, the rules are the package's.

  One user-visible delta rides along, and it is the point of gate row 13 ([#2001](https://github.com/doctor-school/ds-platform/issues/2001)):
  on the doctor storefront a 429 from the confirmation step now renders
  «Слишком много попыток. Подождите пару минут и попробуйте снова.» instead of
  «Код не подошёл. Попробуйте ещё раз.» — the confirm-step `catch` routes through
  the same dictionary as every other auth failure, so the status decides the
  sentence. The Academy keeps its own wording and behaviour; its captcha token
  now travels in the `x-smartcaptcha-token` header instead of the request body
  (the api has always accepted both), which is the one transport contract the
  package owns.

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

### Patch Changes

- [#2239](https://github.com/doctor-school/ds-platform/pull/2239) [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#2027](https://github.com/doctor-school/ds-platform/issues/2027) — the account FAMILY is a legal return target on both storefronts. The
  shared return-target codec derives the family from the one `routes.account` each
  host already declares (a prefix with a segment boundary, so `/accounts` and
  `/account-evil` are still refused) and hands back the matched page rather than
  the cabinet root. The Academy's `/account` and `/account/events` guest bounces
  now carry their own page to the door, so a doctor who opened «Мои события» and
  signed in comes back to it instead of landing on the discovery listing.

- [#2239](https://github.com/doctor-school/ds-platform/pull/2239) [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#2027](https://github.com/doctor-school/ds-platform/issues/2027) — the auth flow reads the same on both storefronts. Four rules are written
  down in the `@ds/auth-flow` README (S1 a guest on a closed page is turned around
  on the server, before any paint, carrying their own page; S2 a signed-in visitor
  is bounced off the auth forms the same way; S3 every hop between the entry
  screens carries the return target forward through the shared helper, never a
  bare route literal; S4 every landing honours the carried target through the
  host's one landing rule), and every deviation from them is fixed here.

  On doctor.school the confirmation screen's «Войти», the login screen's «Забыли
  пароль», the reset screen's «Войти», the cabinet's password link and the
  `/register` landing now all carry the target; on the Academy the same is true of
  the `/login` and `/verify` recovery links and of `/reset`, whose «Войти» link
  and post-completion landing learn about the carried target for the first time.
  A doctor who arrives at a closed page and wanders between entry, registration,
  confirmation and recovery comes back to the page they opened, whichever screen
  they finished on.

- Updated dependencies [[`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9), [`5dc1a61`](https://github.com/doctor-school/ds-platform/commit/5dc1a617adcb66eb5716d498b4223a133e6947db)]:
  - @ds/design-system@5.5.0
  - @ds/events-storefront@1.0.0
