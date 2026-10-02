# @ds/api-client

## 3.0.0

### Major Changes

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

- [#2402](https://github.com/doctor-school/ds-platform/pull/2402) [`dbc5624`](https://github.com/doctor-school/ds-platform/commit/dbc5624ef3cacf00d7fb60119f5045248fe22299) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A congress registrar can mark a participant present per congress day (044
  EARS-34, [#2381](https://github.com/doctor-school/ds-platform/issues/2381), backend layer). New route
  `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`
  with body `{ present: boolean }` (`check: policy`, bound to the registrar's event
  per EARS-38, live revalidation): an idempotent mark/clear whose no-op writes no
  ledger row; a day outside the new REQUIRED `CONGRESS_SIGNUP_EVENT_DAYS` setting is
  422 `CONGRESS_DAY_UNKNOWN`. Migration 0041 adds the audited
  `registration_attendance(registration_id, day, present)` table (no author/time
  columns — the 010 ledger holds who and when). The roster read gains
  `congressDays`, per-row `attendance`, and the `attendanceDay` + `present`
  (`marked` | `unmarked`) filter. `@ds/db` exports `registrationAttendance`;
  `@ds/schemas` exports the `CongressAttendance*` schemas; `@ds/api-client` is the
  regenerated SDK.

- [#2395](https://github.com/doctor-school/ds-platform/pull/2395) [`87e7143`](https://github.com/doctor-school/ds-platform/commit/87e7143dd89b7d6d9942f7008f92c64899dd8431) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A congress registrar can enter a walk-in participant at the desk (044 EARS-35,
  [#2382](https://github.com/doctor-school/ds-platform/issues/2382)). The new route `POST /v1/admin/events/:idOrSlug/registrations`
  (`check: policy`, bound to the registrar's event per EARS-38; the platform
  administrator is not limited) runs the SAME congress intake use-case as the site
  form — one credential-less account per email, one registration per pair, one
  consent per version, the same confirmation email — without the captcha, the rate
  limit and the registration window, and requires `paperConsent: true`. It answers
  `{ status: "accepted" | "existing", registrationId }` and never whether the
  account existed before. Migration 0040 adds `registrations.intake_origin`
  (`site` | `desk` | `platform`, backfilled `site` where answers exist and
  `platform` otherwise, then `NOT NULL DEFAULT 'platform'`) and the nullable
  `consent_records.origin` (`paper` for a desk-recorded consent). `@ds/db` exports
  `IntakeOrigin` / `ConsentOrigin`; `@ds/schemas` exports
  `CongressDeskRegistrationRequestSchema` / `CongressDeskRegistrationResponseSchema`;
  `@ds/api-client` is the regenerated SDK.

- [#2451](https://github.com/doctor-school/ds-platform/pull/2451) [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A platform administrator can read and save the congress intake settings of an
  event (046 EARS-1…EARS-3, [#2432](https://github.com/doctor-school/ds-platform/issues/2432), backend layer). New routes
  `GET` / `PUT /v1/admin/events/:id/congress-intake-settings` (`platform_admin`,
  fast-path; the `PUT` revalidates live): per event the registration address, the
  first-author rule; per kind (`oral`, `poster`,
  `abstract`) the opening day, the last day, the submit limit and the age limit.
  Days are Moscow calendar days, stored as 00:00 Moscow of the opening day and of
  the day after each last day. An event without settings reads
  `configured: false` with the product defaults. An opening without a last day, a
  last day before the opening, a limit below 1 and an age limit outside 18…99 are 400. Migration 0042 adds the audited `congress_submission_settings` and
  `congress_submission_kind_settings` tables. `@ds/schemas` exports the
  `CongressIntakeSettings*` contract, the Moscow day↔instant helpers,
  `isCongressKindIntakeOpen`; `@ds/api-client` is
  the regenerated SDK.

- [#2414](https://github.com/doctor-school/ds-platform/pull/2414) [`b1e5396`](https://github.com/doctor-school/ds-platform/commit/b1e5396f7a3516895a1e1dcd10a7fd62090d9f61) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A congress registrar can read one participant's card (044 EARS-36, [#2383](https://github.com/doctor-school/ds-platform/issues/2383),
  backend layer). New read-only route
  `GET /v1/admin/events/:idOrSlug/registrations/:registrationId` (`check: policy`,
  bound to the registrar's event per EARS-38, `revalidate: none`): every stored
  answer (surname, first name, patronymic, full name, specialty, workplace, city,
  region, phone as typed, email), the registration date and `intakeOrigin`
  (`site` | `desk` | `platform`), the congress consent rows (purpose, version,
  captured-at, `paper` origin), the confirmation-mail outcome with its time, the
  read-time «возможный дубль» marker, and per congress day the current mark
  (`null` = never marked) with its history of changes — value, time, actor name,
  source — read from the 010 change audit (the first reader of `audit_ledger`).
  The card never carries whether the account pre-existed the registration. A
  registration of another event through this event's path is a 404. `@ds/schemas`
  exports the `CongressParticipantCard*` schemas; `@ds/api-client` is the
  regenerated SDK.

- [#2339](https://github.com/doctor-school/ds-platform/pull/2339) [`a4c37d2`](https://github.com/doctor-school/ds-platform/commit/a4c37d24812727cbfad64cd969446b0ee234848a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The congress sign-up intake is live on the API ([#2294](https://github.com/doctor-school/ds-platform/issues/2294), feature 044 slice 2):
  `POST /v1/congress/sign-up` takes a submission from the congress site — public,
  captcha-gated and throttled — and, for an address the platform does not know
  yet, creates the whole cascade in one transaction: a credential-less account
  through the shared 003 engine, a registration for the configured congress event
  carrying the typed answers, and one personal-data consent row stamped at the
  server-configured version (ADR-0009 §2.1). Nothing asks the participant for a
  password, and nothing sends a verification mail: a congress sign-up is not a
  platform registration.

  The registration window is decided first and from the clock alone, before the
  configuration is read and before the account lookup, so a submission outside it
  is refused identically for a known and an unknown address and provably writes
  nothing. Outside the window the refusal names the state (`not-yet-open`, with
  the opening instant, or `closed`); every other reason the intake cannot take a
  submission collapses into one generic refusal, so the unauthenticated endpoint
  is no «is this doctor on the platform?» oracle.

  `@ds/schemas` gains the congress request/response contract and the
  personal-data consent purpose; `@ds/api-client` is the regenerated SDK for the
  new route. The rate limiter gains a per-scope ceiling map: the intake keeps its
  own 60 / 15 min per client address — a congress landing page behind one
  corporate NAT legitimately submits far more than an auth door does — while the
  platform default of 20 for register / login / reset is untouched.

  The existing-email path is refused generically until slice 3 ([#2299](https://github.com/doctor-school/ds-platform/issues/2299) / [#2300](https://github.com/doctor-school/ds-platform/issues/2300) /
  [#2301](https://github.com/doctor-school/ds-platform/issues/2301)), and the confirmation email lands with slice 4 ([#2304](https://github.com/doctor-school/ds-platform/issues/2304)–[#2306](https://github.com/doctor-school/ds-platform/issues/2306)).

- [#2519](https://github.com/doctor-school/ds-platform/pull/2519) [`3ae7607`](https://github.com/doctor-school/ds-platform/commit/3ae7607a52c1143dcd1fae78b854ce627cf94b6b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress abstracts on the author's submissions API (046 EARS-21…25, [#2435](https://github.com/doctor-school/ds-platform/issues/2435)): an
  abstract draft carries the title, the authors with no presenting mark and five
  plain-text sections — «Актуальность», «Цель», «Материалы и методы»,
  «Результаты и обсуждение», «Выводы» — each non-empty at send and together at
  most 5000 characters by `abstractLength` (`@ds/schemas`: each section trimmed,
  CRLF as one line break, spaces and line breaks counted), the same function the
  form's counter uses; above it the send is refused (`field-invalid` on `body`
  with `{length, max}`). The send takes the two statements «В тексте нет
  некорректных заимствований» and «В тексте нет торговых наименований»
  (`statements: ["plag", "trade"]`), each missing one refused as
  `statement-required`, and stores them with their instant; publication is
  covered by the one submission consent. With the event's first-author rule on,
  the kind's limit also binds every submitter's counted submissions with the
  same normalised first author (`first-author-limit-reached` with
  `{limit, used, firstAuthor}`). Creating an
  abstract with `derivedFromId` («Подать тезисы по этой работе») copies the title
  and authors of the author's own sent oral talk or poster — not a draft or a
  withdrawn one — and links to it. A submission now carries `derivedFromId` and
  `statements`.

  The cabinet offers abstracts: «Начать заявку» on «Тезисы» opens the abstract
  form — «Название тезисов», the authors in publication order, «Текст тезисов»
  with its five sections and one total counter in the send panel («4 998 /
  5 000», marked from 4 500, «осталось N» / «больше на N») — with the two
  statements before the consent, sent with it. The refusals read in the canvas
  words — «Сократите текст тезисов до 5 000 знаков — сейчас N», «Подтвердите,
  что в тексте нет некорректных заимствований» / «… торговых наименований» —
  and the first-author refusal names the author: «С первым автором «{ФИО}» уже
  отправлено N тезисов из N — эту заявку отправить нельзя.» Like every failed
  send, a refusal at the abstracts' limit or by the first-author rule keeps
  «Текст заявки сохранён.» under it. A sent oral talk or
  poster offers «Подать тезисы по этой работе» in the list and in its detail
  while abstracts can be started; it opens the prefilled abstract draft. Each statement's and the consent's error line is part of its box's
  aria-describedby, like the title and section fields.

- [#2513](https://github.com/doctor-school/ds-platform/pull/2513) [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress posters on the author's submissions API (046 EARS-18…20, [#2434](https://github.com/doctor-school/ds-platform/issues/2434)): a
  poster draft carries the title, the authors in publication order with no
  presenting mark, the goal (1–1000) and the content (1–3000), with no file
  field. Migration 0045 adds the nullable `users.birth_date`, written only by its
  holder through the new `PUT /v1/me/birth-date` and shown back to them in the
  section (`birthDate`). A poster draft is created without a birth date; sending
  it without one is refused (`field-invalid` on `birthDate`). A kind with an age
  limit refuses an account whose full years on the event's Moscow start day
  reach it — at creation when a birth date is stored, and at send — with an
  `age-limit` refusal carrying `{maxAgeYears, eventStartDate, age}` that the
  cabinet reads as «Постерные доклады принимают от участников младше {N} лет на
  дату начала Конгресса — {дата}. На эту дату вам будет {возраст} лет.». The
  section's kinds carry `maxAgeYears`; other kinds are unaffected.

  The cabinet offers the poster: the kind choice creates the draft. The poster
  form holds the topic, the authors in publication order (no speaker choice, no
  on-site line), «Цель» and «Содержание», and — until the holder has an earlier
  sent poster — the birth date («Дата рождения», the DS date control: a calendar
  day from 1900-01-01 up to today in Moscow, «Спрашиваем один раз — перед первым
  постером.»), written on blur, with «Укажите дату рождения» when it is empty or
  out of that range at send. A holder at or above the age limit sees the
  refusal on the poster card with no start and on a poster draft in place of the
  send; the birth date stays editable there for correction.

  A failed send keeps «Текст заявки сохранён.» under the refusal also when the
  refusal is tied to no field (limit, revision deadline, closed intake).

  `@ds/design-system`: the theme root declares `color-scheme` — `light` on
  `:root`, `dark` under `.dark` — so native control parts (the date picker
  indicator, scrollbars, autofill, select chrome) follow the resolved theme; in
  dark the calendar glyph of a date input was a dark icon on the near-black field.
  Embedded frames keep the UA scheme (`iframe { color-scheme: normal }`): per
  CSS Color Adjust 1 §2.4 a frame whose scheme differs from its document's gets
  an opaque Canvas backdrop, so the inherited `dark` turned the light SmartCaptcha
  challenge into a solid light box over a dark page.

  A cabinet field's error line is referenced by its control's
  `aria-describedby` (topic, «Цель»/«Содержание» and the other text fields, the
  birth date with its hint).

### Patch Changes

- [#2356](https://github.com/doctor-school/ds-platform/pull/2356) [`e26551d`](https://github.com/doctor-school/ds-platform/commit/e26551d777b683079f7dbed7f68e9ab8475a4508) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fence the `event-registrar` role to its allow-set (044 EARS-19, [#2312](https://github.com/doctor-school/ds-platform/issues/2312)): the role joins the `role → mfa_required` policy and the admin second-factor entry routes, so a registrar reaches the admin origin on the `platform_admin` TOTP flow and may hold a session — sign in, enrol/answer the factor, read back its own roles through the new `GET /v1/admin/auth/session`, sign out. Reach is unchanged everywhere else: every other real route, including every create, update and delete, omits the role and `AuthzGuard` refuses it. The generated matrix carries no denial-set column, so that half is proven by a sweep over the real registered route set.

- [#2355](https://github.com/doctor-school/ds-platform/pull/2355) [`7bb7040`](https://github.com/doctor-school/ds-platform/commit/7bb7040046f9ee2f2f4f0b3c007918bc9d2cba84) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the roster HTTP route over the event read model (044 EARS-18, [#2311](https://github.com/doctor-school/ds-platform/issues/2311)): `GET /v1/admin/events/:idOrSlug/roster` answers a paged, instant-searchable page of the registrar's desk roster — ФИО, specialty name, место работы, город, область, телефон as typed, email, registration instant and the confirmation-letter outcome — authorized for `event-registrar` and `platform_admin` on its own controller. It is a second, widened read (`eventRosterPage`) beside the PII-free `eventRoster()` the room gate consumes, which is unchanged. Query state is the `AdminDataList` baseline (`q`, `page`, `pageSize`) only; sorting, per-column filters and the «возможный дубль» marker on this row are EARS-22/23/30/31.

## 2.0.0

### Major Changes

- [#1760](https://github.com/doctor-school/ds-platform/pull/1760) [`04fa58f`](https://github.com/doctor-school/ds-platform/commit/04fa58f9dcbbc0131e30bdb3cd0bb52413c05d9d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 007 EARS-28 / [#1748](https://github.com/doctor-school/ds-platform/issues/1748) — the hidden broadcast state is renamed `archived` → `hidden`
  («Скрыто»), and its command `ArchiveEvent` → `HideEvent` («Скрыть»).

  Breaking on the wire and in the SDK. The `event_lifecycle_state` enum's terminal
  value is `hidden` (`@ds/db` migration 0033 relabels the Postgres enum in place,
  so every existing row follows and nothing is rewritten); `EventLifecycleState`
  and every schema deriving from it (`@ds/schemas`) speak `hidden`; the admin
  transition route moves from `POST /v1/admin/events/:id/archive` to
  `…/:id/hide` and the audit type from `event.archived` to `event.hidden`
  (`@ds/api`), with `@ds/api-client` regenerated against it. `@ds/admin` shows the
  status «Скрыто» and the action «Скрыть»; `@ds/portal` renders the hidden event's
  notice as «Мероприятие скрыто». No dual-read shim and no compatibility alias —
  the old value is gone.

  The word «Архив» now denotes only the SHOWN recordings archive (014): the public
  archive listing, its badge, «Мои события» and the `/webinars` past tab are
  untouched.

- [#1815](https://github.com/doctor-school/ds-platform/pull/1815) [`d565d04`](https://github.com/doctor-school/ds-platform/commit/d565d049c4597b7ab2e30d34ec673f110abcfaf7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 014 EARS-23…27 / [#1741](https://github.com/doctor-school/ds-platform/issues/1741) (slice 1 of 3) — an эфир held BEFORE the platform existed
  gets its own lifecycle, and the `MarkEventEnded` fork leaves feature 007's machine.

  Breaking on the wire, in the SDK and in the database. `events.origin`
  (`platform | legacy`, `@ds/db` migration 0035, NOT NULL, default `platform`) is a
  server-assigned discriminator that picks the state machine and is rejected by
  every update path; `event_lifecycle_state` gains `in_archive`, reachable only on
  the legacy machine (`hidden ↔ in_archive`). Feature 007's machine loses its
  `published → ended` edge and the `POST /v1/admin/events/:id/mark-ended` route
  with it; `validTransitions(state)` / `canTransition(from, to)` become
  origin-aware (`validTransitions(state, origin)`), so every caller passes the
  machine explicitly. Three routes are added: `POST /v1/admin/legacy-broadcasts`
  (create, born `hidden`, carrying its recording), `POST …/:id/archive-legacy`
  («Архивировать», requires a published non-retired recording — 409
  `EVENT_NOT_FINISHED` otherwise) and `POST …/:id/hide-legacy` («Скрыть»). Every
  broadcast command on a `legacy` event and every legacy command on a `platform`
  event is refused 409 `INVALID_TRANSITION` with no mutation. Recording
  publication is now gated per machine: `ended` on the platform machine as before,
  either legacy state on the legacy one — an эфир that never passed through the
  platform room can never be `ended`, and without this its recording could never be
  published at all.

  The archive projection is unchanged for readers: an `in_archive` legacy эфир is
  the same `recorded` card a platform `ended` broadcast with a published recording
  already was. `@ds/admin` loses the «Отметить завершённым» action, `@ds/portal`
  renders `in_archive` exactly as `ended`; the full admin lifecycle bar and the
  «Архивный эфир» creation form land in slices 2 and 3.

### Minor Changes

- [#1739](https://github.com/doctor-school/ds-platform/pull/1739) [`98d9509`](https://github.com/doctor-school/ds-platform/commit/98d9509a65216edfd8d6c99a9074b82d011e4cd9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 019 EARS-3 — the day-grouped, specialty-targeted doctor events feed.

  Additive across the chain and breaking nowhere. `@ds/schemas` gains the
  `doctor-events-feed` contract plus the ONE query codec both hosts decode with;
  `@ds/api` serves `GET /v1/storefront/doctor/events` and `@ds/api-client`
  regenerates against it; `@ds/design-system`'s `EventList` widens with the
  optional `tenseControl` / `paginationMode: "none"` / `footer` props a host
  reading a single tense over a bounded horizon needs (every existing caller
  keeps its current behaviour); `@ds/doctor` gains the `/events` route.

- [#1876](https://github.com/doctor-school/ds-platform/pull/1876) [`e926d75`](https://github.com/doctor-school/ds-platform/commit/e926d75c9c71037687fc25de37e41539a3ba3d6d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 §6.1 / 006 EARS-2 ([#1722](https://github.com/doctor-school/ds-platform/issues/1722) slice 3) — the doctor storefront mounts the shared live room at `/events/:slug/room`.

  The room is the same `@ds/room` unit the Academy runs, not a second implementation: this host adds only its session forward, its own upstream base, its own route table (all three refusal branches stay on doctor.school — this host has no login route) and its own RU copy. The route lives in a new `(room)` group so it renders outside the 017 storefront chrome.

  The api's doctor route table now resolves `roomPath`, so a registered doctor on a live event gets `enter-room` with a real target on doctor.school instead of the `href: null` it carried while the route did not exist.

  020 EARS-7 is now delivered whole: the participation CTA carries `presenceCount` — the live count of colleagues already in the room — on `enter-room` and `null` on every other action, read from the SAME distinct-doctor aggregate and the SAME config-derived freshness window the 006 room grant uses. The shared `EventSignupCard` renders it as one plain-RU line («В эфире уже N коллег», correct plural forms), so both storefronts gain it at once.

  The doctor room header now carries the EARS-15 initials avatar (initials from the doctor's real saved display name only), and the room's `register` refusal carries `?from=room` like the Academy's.

  The design system gains the header chip both storefronts wear, so neither host declares it: a new `header` variant on the `Avatar` primitive (the canvas white-on-navy chip — white square, navy ink in both themes, offset `shadow-header-chip` cast, static because the doctor chip is not a link) and a new `@ds/design-system/header-chip` entry point exporting `HEADER_CHIP_SURFACE` (the one surface constant both compose) plus `HEADER_CHIP_BASE` (that surface with the neo-brutalist press chain, for interactive chips). The Academy's profile chip and its shell «Войти» chip now IMPORT `HEADER_CHIP_BASE` instead of declaring it, so the two rooms cannot drift.

  The CTA's `presenceCount` now counts COLLEAGUES: the requesting doctor's own live presence is excluded, because the line reads «В эфире уже N коллег». The 006 in-room header count is unchanged — there the number is the room population and correctly includes the viewer.

- [#1707](https://github.com/doctor-school/ds-platform/pull/1707) [`d32a070`](https://github.com/doctor-school/ds-platform/commit/d32a07089ea8b9c36f8cb085cc610d238042a70e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 014 EARS-5: login-gated playback — the webinar archive page serves a source-free
  public read plus a guest gate («просмотр бесплатен, нужен аккаунт») whose sign-in
  action carries the EARS-6 return target, and mounts the recording player for an
  authenticated doctor.

  Bump letter — `minor` (additive, no break, per repo-conventions → Bump letter):
  `@ds/schemas` and the regenerated `@ds/api-client` gain the new playback contract
  without changing any existing export or field shape; `@ds/api` adds a new
  authenticated endpoint `GET /v1/events/:idOrSlug/recordings` and leaves every
  existing route's response untouched (the public read stays source-free); `@ds/portal`
  adds a new user-visible capability to an existing page with no removed behaviour.
  No migration in this slice.

- [#1807](https://github.com/doctor-school/ds-platform/pull/1807) [`5a8e03f`](https://github.com/doctor-school/ds-platform/commit/5a8e03f0746ffcc3b8fb7260d906785f4b7b9a0e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 EARS-1 — one shared event-page core: `EventPageView` (the 004 public projection widened in place with `format` and `seatsLeft`) is now read by both storefronts, the doctor host through the new `GET /v1/storefront/doctor/events/:idOrSlug` that delegates to the same service. Participation is a single server-resolved policy — `ParticipationCta` (`register` · `registered` · `enter-room` · `switch-to-online` · `sold-out` · `unavailable`) — served as a per-viewer sibling read on each host, so neither storefront branches on lifecycle, registration, format or seats of its own.

- [#1740](https://github.com/doctor-school/ds-platform/pull/1740) [`cdd7b52`](https://github.com/doctor-school/ds-platform/commit/cdd7b52c9c64d27c976c08f4060b64f0c54830bd) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 021 EARS-4 — the mandatory medical-worker declaration.

  Adds the `RegisterDoctor` command contract (`DoctorRegisterRequestSchema`) with
  `medicalWorkerDeclaration: z.literal(true)`, the `medical-worker-declaration`
  consent purpose and the stable refusal code, plus the generated client types for
  `POST /v1/storefront/doctor/register`.

## 1.0.0

### Major Changes

- [#1686](https://github.com/doctor-school/ds-platform/pull/1686) [`f8cb3f9`](https://github.com/doctor-school/ds-platform/commit/f8cb3f93c6c2512433a5840afcbdbbb0ef28a712) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Complete the ADR-0016 §5 `topics` → `directions` rename through the 012 EARS-11
  event join ([#1645](https://github.com/doctor-school/ds-platform/issues/1645)). The table is now `event_directions` with a `direction_id`
  column (true rename — every retained row, id, version and audit lineage
  survives), the admin surface is `/v1/admin/event-directions`, and the public
  traversal answers `GET /v1/public/events/:idOrSlug/directions` and
  `GET /v1/public/directions/:idOrSlug/events`.

  Breaking: the old `event-topics` / `…/topics` routes and the `EventTopic*` /
  `PublicTopicSummary*` contract exports are gone with no alias — the rename has
  no consumers outside this repo. Behaviour, pagination, problem shapes and
  visible RU copy are unchanged.

## 0.1.0

### Minor Changes

- [#1636](https://github.com/doctor-school/ds-platform/pull/1636) [`3a13d7c`](https://github.com/doctor-school/ds-platform/commit/3a13d7cca9ec57062a8c102ef811471a7eb86651) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#1610](https://github.com/doctor-school/ds-platform/issues/1610): author all five taxonomy relationships from either endpoint with one retained command, bounded server search, and the canonical in-dropdown Combobox.
