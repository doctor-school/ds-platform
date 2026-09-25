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

- [#2324](https://github.com/doctor-school/ds-platform/pull/2324) [`5064784`](https://github.com/doctor-school/ds-platform/commit/506478497fa1b6879a8f26eb60c01db32d145113) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One sign-in door on both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1). `@ds/auth-flow/login`
  owns the `/login` screen — the identifier and password fields, the method switch, the
  return-context card and the post-sign-in landing — and both hosts mount it from their
  own route file plus host config. The Academy door is now rendered by the package rather
  than by `apps/portal/app/login/page.tsx`, with no change a signed-in user can see.

  On the doctor storefront the door gains what only the Academy had: the submit button
  reports its in-flight state (`aria-busy`) instead of going quiet, the SmartCaptcha
  challenge is rendered where the api asks for a token, and the «passing the automated
  check» processing notice appears while that token is minted. The same notice now also
  shows on the doctor `/register` and `/reset` screens, which sit inside the shared
  `AuthShell` frame this PR moves into the package. Copy, field order and the steps
  themselves are unchanged on both storefronts.

- [#2338](https://github.com/doctor-school/ds-platform/pull/2338) [`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One sign-up door on both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1).
  `@ds/auth-flow/register` owns the `/register` screen — the credential fields, the
  consent block, the bot-protection challenge and the post-registration confirmation
  step — and both hosts mount it from their own route file plus host config. The
  Academy door is now rendered by the package rather than by
  `apps/portal/app/register/page.tsx`, with no change a signed-in user can see.

  Both doors gain the already-registered visitor's way out, «Уже есть аккаунт?
  Войти» ([#2331](https://github.com/doctor-school/ds-platform/issues/2331)), which carries the return target forward like every other
  transition between auth screens; the shared error dictionary now answers a
  rate-limited (429) or failing (5xx) sign-up with the same sentence on both hosts;
  and a return target only rides along once the shared guards have revalidated it.

  Consent tiers, the medical-worker declaration and the partner-data item stay host
  DATA, so each storefront keeps asking exactly what it asked before. The doctor
  storefront's confirmation step is unchanged in what it does and says — it is now
  rendered by the package.

  `<RegisterCard>` draws ONE sign-up composition now. The three host-divergence
  knobs (`submitBlock`, `spacing`, `pendingAffordance`) are gone and the block
  follows the owner's canvas on both storefronts: no consent-withdrawal sentence
  stands on the door (the package default `managerNote` is gone; `consentNote`
  stays a generic slot no host fills), a hairline rule separates the conditions, the
  read-only «продолжая, вы соглашаетесь…» statement stands after that frame and
  above the challenge, and the optional opt-in below the submit carries no
  «необязательно» marker — its position says it. A new `partnerPlateSlot` renders
  the partner-link notice under the promo field. `<LoginCard>` moves the challenge
  from the head of the sign-in-code step to directly above the button it protects,
  as it already stood on the password method. The `Checkbox` box no longer shrinks
  when its label wraps onto several lines.

  Every auth sentence now has ONE source: the package copy defaults, taken from the
  owner's auth canvas. A host config states the SET of fields it renders, its routes,
  endpoints, channels and brand assets — no host words a field any more. The
  optional `copy` deep-partial override carries exactly one host statement: the
  Academy's brand panel (eyebrow «Академия Doctor.School», headline «Среда обитания
  экспертов здравоохранения», sub-copy «Эфиры, программы и сертификация от
  практикующих экспертов — в одном пространстве.», footer «© Doctor.School.»); the
  doctor storefront keeps the package brand copy. On the doctor storefront the
  return-context panel beside the door takes the brand panel's measures: the
  eyebrow at .14em in the panel's pale blue, the assurance line at 14px on the 1.6
  line in the same pale blue, capped at 44ch. `AuthFlowBrandCopy.subcopy` is
  `string | null`, and `<AuthShell>` renders no sub-copy node when its `copy.subcopy`
  is absent or null. The sign-in password field shows the same canvas `••••••••`
  placeholder as sign-up on both hosts (new optional
  `LoginCard` `copy.password.passwordPlaceholder`, package default in auth-flow).

  The sign-up button is LIVE in every state, as the owner's canvas draws it. The
  disabled submit and the reason line beside it are gone — with them the
  `RegisterCardProps.unmetPrecondition` prop and the `RegisterCardTestIds.submitReason`
  test id, both removed from the block's public surface (breaking for any consumer
  that set them; both storefronts are updated here). Pressing with an access
  condition still ungranted states it UNDER the row it belongs to — the same
  sentence as before, now tied to its own checkbox, which turns to the danger tone
  while the statement stands — and sends no command; granting one condition clears
  only its own statement, and the optional opt-in never states anything. A host
  that words a condition its read model carries no statement for says so in the
  card's error banner instead, so a misconfiguration fails at the door rather than
  silently at the server.

  The consent block is drawn from the canvas: the access-conditions frame loses its
  filled header bar for a quiet eyebrow inside a uniform padding, the two
  conditions are separated by a hairline rule, and every consent label — the
  marketing opt-in included — is bold in the ink tone above a small quiet help
  line. `Checkbox` therefore renders its label bold everywhere it is used, and
  paints its box in the danger tone while the control it wraps is `aria-invalid`.

  The auth card family now renders to the canvas measures on both storefronts: the
  logo, the card and the processing notice under it share a 440px column (new
  `--container-auth` token, `max-w-auth`); the title stands 10px above its
  sub-copy; the badge glyph is 26px and takes the tile's accent in dark mode too;
  the «Уже есть аккаунт? Войти» line sits 24px under the form instead of 36px; an
  error-free sign-up card no longer reserves an empty banner gap above the glyph;
  the invisible bot-protection mount no longer adds a second gap above the submit;
  the password hint hangs 7px under its field; the processing notice under the card
  is a left-aligned faint 12/18 line; and the sign-up password field shows the
  canvas `••••••••` placeholder (new `RegisterCardCopy.passwordPlaceholder`).

- Updated dependencies [[`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14), [`1853c46`](https://github.com/doctor-school/ds-platform/commit/1853c46b619aa78d69e4da96c6d5e1a7a02d517d), [`096f73f`](https://github.com/doctor-school/ds-platform/commit/096f73ff412db2ac636cd04cb624209e7613da93), [`a4c37d2`](https://github.com/doctor-school/ds-platform/commit/a4c37d24812727cbfad64cd969446b0ee234848a), [`e26551d`](https://github.com/doctor-school/ds-platform/commit/e26551d777b683079f7dbed7f68e9ab8475a4508), [`7bb7040`](https://github.com/doctor-school/ds-platform/commit/7bb7040046f9ee2f2f4f0b3c007918bc9d2cba84), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`e33baab`](https://github.com/doctor-school/ds-platform/commit/e33baab31e3f594a62470977270848e733a20fcc), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`5912916`](https://github.com/doctor-school/ds-platform/commit/5912916deaab5efea847a94fada3f0ea232634b1), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9), [`5dc1a61`](https://github.com/doctor-school/ds-platform/commit/5dc1a617adcb66eb5716d498b4223a133e6947db)]:
  - @ds/design-system@5.5.0
  - @ds/schemas@6.1.0
  - @ds/events-storefront@1.0.0
  - @ds/room@1.0.0
