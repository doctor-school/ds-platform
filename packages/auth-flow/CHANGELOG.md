# @ds/auth-flow

## 1.0.0

### Major Changes

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

- [#2460](https://github.com/doctor-school/ds-platform/pull/2460) [`103c74d`](https://github.com/doctor-school/ds-platform/commit/103c74deb7f6e51c0467c520ebfd1813272000bb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One registration-confirmation mechanism on both storefronts ([#2455](https://github.com/doctor-school/ds-platform/issues/2455)).

  - The doctor storefront now confirms a registration on its own `/verify` route
    (`apps/doctor/app/(auth)/verify/page.tsx`), the same `@ds/auth-flow/verify`
    step the Academy mounts: registration hands the visitor over with the address
    and the carried return target in the query. The in-place confirmation branch of
    the registration door is gone.
  - ONE confirm command on both hosts: the 003 `POST /v1/auth/verify` (address +
    code). The doctor-storefront command `POST /v1/storefront/doctor/confirm`, its
    `DoctorConfirm*` schemas and SDK types are removed — it was that 003
    verification plus a server-side landing decision.
  - The landing after confirmation is decided the same way on both hosts (owner
    decision «Б», 2026-09-29, 021 Amendment — 2026-09-29): the page of the эфир
    the visitor came from, even when it has ended or filled up (the page states
    that itself); an эфир that no longer exists → the default landing. The one
    public event read is asked on every host when the code is accepted; only its
    not-found answer means «no longer exists» — a failed read keeps the эфир page.
  - `AuthFlowHostConfig` breaking changes: `routes.verify` is required;
    `api.confirmPath`, `api.confirmCarriesReturnTarget` and
    `verify.deepLinkEntry` are removed (the verification mail is link-free, so the
    `/verify#email=` fragment is no address); the auth client's `confirm` is
    replaced by a typed `verify`. `resolveConfirmLanding` is removed.
  - The return-context card («Вы вернётесь к этому событию» + the эфир + the
    assurance line) is drawn on both storefronts, on «Вход», «Регистрация» and
    «Подтверждение», wherever the arrival resolved an эфир — the canvas `auth`
    draws it for both hosts. `returnTo.card` is removed from
    `AuthFlowHostConfig`; the sign-in door takes the same one эфир read as the
    other doors. Only a not-found answer drops the target, and on the Academy it
    drops the parked copy of that target too: after sign-in the visitor lands on
    the default landing, never on the page of an эфир that no longer exists. The
    parked target still carries every arrival the door does not judge (a room, the
    personal account, a direct arrival).
  - A signed-in visitor on the Academy `/verify` is sent to the landing the
    registration door would send them to (`/webinars`), not to `/account`.

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

- [#2492](https://github.com/doctor-school/ds-platform/pull/2492) [`1cb4407`](https://github.com/doctor-school/ds-platform/commit/1cb4407ad373d69480b4c8ebded47bb82161912a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One sign-out destination on both storefronts ([#2488](https://github.com/doctor-school/ds-platform/issues/2488)).

  - `@ds/auth-flow/host-config` exports `SIGN_OUT_DESTINATION` (`"/"`, 003
    EARS-10): where a visitor lands after signing out from `/account`. A package
    constant, not host data — the two storefronts cannot diverge on it.
  - The Academy account page now sends a signed-out visitor to the storefront home
    (`/`) instead of `/login`; doctor.school already did. Both account screens
    navigate to the package constant.

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

- [#2408](https://github.com/doctor-school/ds-platform/pull/2408) [`247b352`](https://github.com/doctor-school/ds-platform/commit/247b3524c9addd7e7ebf83a19ac8615a79b3e306) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One password-recovery flow on both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1).
  `@ds/auth-flow/reset` owns both stages of «Сброс пароля» — the identifier step
  behind the invisible challenge, the code and new-password step with its reveal
  toggle, the resend with its neutral notice, «Начать заново» and the way back to
  sign-in — and both hosts mount it from their `/reset` route through
  `@ds/auth-flow/reset/route`. A signed-in doctor can still open `/reset` (the
  cabinet «Сменить пароль» entry), and a completed reset still lands signed in on
  this host's account page — or on the account or эфир page the visitor arrived
  carrying; any other carried page, an эфир room included, lands on the account
  page.

  What a visitor can notice: the words now follow the owner's canvas on both
  hosts — «Сброс пароля» / «Новый пароль», «Отправить код сброса», «Задать новый
  пароль», «← Вернуться ко входу» and the conditional «Если для … есть аккаунт, мы
  повторно отправили код.» (the doctor storefront used its own wording before);
  the card shows the canvas key glyph; the doctor storefront's new-password field
  gains the show-password toggle the Academy already had; and a reset that
  started from an эфир on the doctor storefront now completes that registration
  before landing, as sign-in does. The doctor storefront, which serves no SMS,
  accepts an email address in the identifier box. The code field is unchanged.
  A refused request, a refused code or password and a refused resend are now
  said in the one error plate above the key glyph, as on the other sign-in
  screens; asking for a new code withdraws a standing «Код не подошёл или пароль
  отклонён.».

- [#2388](https://github.com/doctor-school/ds-platform/pull/2388) [`c754a6d`](https://github.com/doctor-school/ds-platform/commit/c754a6d5a11e8d72ef26d7cc756cc26cafda3977) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One confirmation step on both storefronts ([#2027](https://github.com/doctor-school/ds-platform/issues/2027), epic [#2020](https://github.com/doctor-school/ds-platform/issues/2020) wave 1).
  `@ds/auth-flow/verify` owns the «Проверьте почту» step — the code field, the
  resend link with its notice line, the success banner and the «Уже
  регистрировались?» way out — and both hosts render it: the Academy mounts
  `@ds/auth-flow/verify/route` from `apps/portal/app/verify/page.tsx`, the doctor
  storefront renders the same body inline on its registration door. The Academy
  deep link from the verification mail (`/verify#email=…`) keeps working; a host
  opts into it with `verify.deepLinkEntry`.

  What a visitor can notice: every failure — a wrong code, a refused resend, a
  rate-limited (429) or failing (5xx) request — now appears as ONE banner above the
  title, worded by the shared error dictionary on both hosts; an incomplete code
  says «Введите код.»; the doctor storefront shows «Код принят — входим…» once the
  code is accepted and refreshes the page after landing, as the Academy did.
  The code stays six characters with a letter-capable keyboard.

  `<EmailConfirmCard>` follows the owner's canvas: canvas eyebrows and gaps, the
  hint and the resend notice at the 13px `caption` step, a hairline rule above the
  already-registered block, the two actions sharing one
  wrapping row, and the error plate above the title. New, additive: a `testIds`
  prop (defaults are the ids the block shipped with) and the exported
  `EMAIL_CONFIRM_TEST_IDS` / `EmailConfirmCardTestIds`.

- [#2418](https://github.com/doctor-school/ds-platform/pull/2418) [`b2aff14`](https://github.com/doctor-school/ds-platform/commit/b2aff149c351d8fb23b197d4816f1cb33289385d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 EARS-7 ([#2242](https://github.com/doctor-school/ds-platform/issues/2242)): a guest who opens a doctor-storefront room URL `/events/<slug>/room` is now redirected to this host's `/login?returnTo=%2Fevents%2F<slug>%2Froom` instead of the event page, and signing in lands them back in the room where the entry gate re-runs — the same door the Academy room uses. The `@ds/room` return codec now validates a room return against the host's own event-page shape (`/webinars/<slug>` or `/events/<slug>`), and the doctor auth-flow config states `room: "/events/:slug/room"`. The shared sign-in and sign-up mounts (`@ds/auth-flow` `LoginRoute` / `RegisterRoute`) now answer a room return from the host's `routes.room` as a landing in its own right, like the account family, so a host without a parking cookie no longer drops it on the default landing.

- [#2416](https://github.com/doctor-school/ds-platform/pull/2416) [`5734653`](https://github.com/doctor-school/ds-platform/commit/57346537ff53a3e42223da952d86f50f30eb592e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A doctor who signs in on the doctor storefront now lands where a doctor who was
  already signed in lands ([#2333](https://github.com/doctor-school/ds-platform/issues/2333), 021 EARS-3 / LD-4): the specialty feed when a
  specialty is remembered — including one kept on the PROFILE rather than in this
  browser's guest cookie — and the front page otherwise.

  The door's landing is decided at guest render, when no session exists and only
  the guest cookie can be read. The shared sign-in, sign-up and confirmation
  mounts now also hand their door a server action (`signedInLandingAction`, a
  package-internal module the mounts import directly — deliberately not exported
  from the `@ds/auth-flow/server` barrel, which also reaches client code) that runs the SAME `resolveArrivalLanding` rule again on
  the action's own request, which carries the new session cookie. The door awaits
  it after password sign-in, after code sign-in and after the post-confirmation
  sign-in, then completes the carried target over it exactly as before: a
  validated `returnTo` still wins, and a failed call keeps the guest-time landing.
  The action closes over the host's landing config (encrypted by Next), so the
  browser passes no argument. The Academy's landing is a constant, so it gets no
  action and behaves byte for byte as before.

- [#2498](https://github.com/doctor-school/ds-platform/pull/2498) [`f497914`](https://github.com/doctor-school/ds-platform/commit/f4979144b471764dc32748ef614dcd4100dde15e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A registration intent lives only inside the sign-in flow that carried it
  ([#2495](https://github.com/doctor-school/ds-platform/issues/2495), 014 EARS-6 amendment 2026-09-30). The shared `parkReturnTarget` rule
  now drops the parked `ds_return_to` target when a guest opens an auth door
  (`/login`, `/register`, `/verify`, `/reset`) without a guard-clean `returnTo`,
  so pressing «Записаться», abandoning the sign-in and later signing in through
  the header no longer registers the visitor. Both storefronts wire the same four
  doors; the reset door joins the doctor proxy and the Academy middleware matcher.

- [#2493](https://github.com/doctor-school/ds-platform/pull/2493) [`972ccca`](https://github.com/doctor-school/ds-platform/commit/972ccca5d12e9bbe83f2be7c0c4ca90aa9401e9e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The header «Войти / Регистрация» brings the visitor back to the event page and
  never registers them ([#2487](https://github.com/doctor-school/ds-platform/issues/2487)): on both storefronts, on an event page the guest
  link carries that page as a land-only return — the page plus the fixed
  `?intent=land` marker, one shape in `@ds/schemas`
  (`formatLandOnlyReturnTarget` / `parseLandOnlyReturnTarget`). The doors carry it
  end-to-end (the same-origin guard keeps exactly this marker, so the parking
  cookie keeps it too) and the shared completion lands on the page without
  `RegisterForEvent`. The event page's own registration button is unchanged. Home,
  feeds and the auth doors keep the bare route.

- [#2401](https://github.com/doctor-school/ds-platform/pull/2401) [`e07356d`](https://github.com/doctor-school/ds-platform/commit/e07356d418754d8886f35ad485465fde731907de) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 003 EARS-40 ([#2394](https://github.com/doctor-school/ds-platform/issues/2394)): a `/verify` opened with no address — no `?email=` query and no `#email=` fragment — now replaces onto `/register`, carrying a same-origin `returnTo`, instead of rendering the step with «ваш аккаунт». The confirmation step always has an address, so the `fallbackDestination` / `missingIdentifier` copy and the address-less resend/submit branches are gone.
- Updated dependencies [[`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14), [`247b352`](https://github.com/doctor-school/ds-platform/commit/247b3524c9addd7e7ebf83a19ac8615a79b3e306), [`c754a6d`](https://github.com/doctor-school/ds-platform/commit/c754a6d5a11e8d72ef26d7cc756cc26cafda3977), [`ed94b36`](https://github.com/doctor-school/ds-platform/commit/ed94b36260d4ef98d16a9d8f0f1e1bdbd33c8449), [`dbc5624`](https://github.com/doctor-school/ds-platform/commit/dbc5624ef3cacf00d7fb60119f5045248fe22299), [`87e7143`](https://github.com/doctor-school/ds-platform/commit/87e7143dd89b7d6d9942f7008f92c64899dd8431), [`1853c46`](https://github.com/doctor-school/ds-platform/commit/1853c46b619aa78d69e4da96c6d5e1a7a02d517d), [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`096f73f`](https://github.com/doctor-school/ds-platform/commit/096f73ff412db2ac636cd04cb624209e7613da93), [`b1e5396`](https://github.com/doctor-school/ds-platform/commit/b1e5396f7a3516895a1e1dcd10a7fd62090d9f61), [`a4c37d2`](https://github.com/doctor-school/ds-platform/commit/a4c37d24812727cbfad64cd969446b0ee234848a), [`e26551d`](https://github.com/doctor-school/ds-platform/commit/e26551d777b683079f7dbed7f68e9ab8475a4508), [`7bb7040`](https://github.com/doctor-school/ds-platform/commit/7bb7040046f9ee2f2f4f0b3c007918bc9d2cba84), [`3ae7607`](https://github.com/doctor-school/ds-platform/commit/3ae7607a52c1143dcd1fae78b854ce627cf94b6b), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`b2aff14`](https://github.com/doctor-school/ds-platform/commit/b2aff149c351d8fb23b197d4816f1cb33289385d), [`026327e`](https://github.com/doctor-school/ds-platform/commit/026327eb09f34c722b68a6a50e0e2b4a3018003c), [`e33baab`](https://github.com/doctor-school/ds-platform/commit/e33baab31e3f594a62470977270848e733a20fcc), [`103c74d`](https://github.com/doctor-school/ds-platform/commit/103c74deb7f6e51c0467c520ebfd1813272000bb), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`5912916`](https://github.com/doctor-school/ds-platform/commit/5912916deaab5efea847a94fada3f0ea232634b1), [`972ccca`](https://github.com/doctor-school/ds-platform/commit/972ccca5d12e9bbe83f2be7c0c4ca90aa9401e9e), [`02891dd`](https://github.com/doctor-school/ds-platform/commit/02891ddabcc0dabe65c912e0a8c038cb90e66d9a), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9), [`5dc1a61`](https://github.com/doctor-school/ds-platform/commit/5dc1a617adcb66eb5716d498b4223a133e6947db)]:
  - @ds/design-system@5.5.0
  - @ds/schemas@7.0.0
  - @ds/room@1.0.0
  - @ds/events-storefront@1.0.0
