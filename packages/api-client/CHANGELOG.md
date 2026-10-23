# @ds/api-client

## 3.0.0

### Major Changes

- [#2711](https://github.com/doctor-school/ds-platform/pull/2711) [`b54d3db`](https://github.com/doctor-school/ds-platform/commit/b54d3dbda91585981f3c29b162049031cd7d3336) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Events storefront wave 2 ([#2028](https://github.com/doctor-school/ds-platform/issues/2028)), the read contract of the one feed view on both hosts: `GET /v1/public/events?timeframe=…` accepts the horizon `from`/`to` of the one listing codec and echoes `horizon { from, to, nextTo, nextFrom, remaining, nextBatch }`; a read stating neither a bound nor a cursor page (`cursor` / `limit`) is the horizon read of the tense's default extent, so the bare «Будущие» and «Прошедшие» reads offer «Показать ещё». The cursor page stays for a read that states `cursor` or `limit` and never combines with a horizon. Every Academy listing card carries its event `kind`, attendance `format` and the colleagues' `signUpCount`; the listing `counts` gain `upcomingSchools`, the distinct schools among the upcoming listing-eligible events («N эфиров · M школ»). The new `GET /v1/public/events/live` serves the Academy «Идёт сейчас» from the one live resolution the doctor host uses.

  The doctor feed `GET /v1/storefront/doctor/events` selects each tense by lifecycle, as the Academy listing does: «Будущие» = published and live events, soonest first; «Прошедшие» = ended and archived events, newest first. Both feed reads carry `nextFrom` («Прошедшие» widens backward), `remaining` (the M of «Показать ещё N из M») and `nextBatch` (the N — the events the next widening step adds). «Прошедшие» has no age floor — «Показать ещё» walks back to the oldest archived event, and a requested `from` older than every matching event is echoed clamped to that event's day. «Будущие» reaches at most a year ahead of today. Every horizon response carries at most 500 events in whole days: a larger extent keeps the days next to the edge «Показать ещё» advances — the oldest («Прошедшие») / farthest («Будущие») — and echoes the moved opposite bound (`to` / `from`), so the next «Показать ещё» URL carries both returned bounds and slides the window; every step brings new events until nothing lies beyond. A doctor feed card of an ended event carries the same 014 `recording` projection as the Academy past card, and the projection gains `durationSec`, the primary cut's length.

  **Breaking:**

  - `@ds/api` / `@ds/api-client`: `GET /v1/storefront/doctor/events/live` returns a list of strips (`[]` when nothing is live) instead of one strip or `null`; `GET /v1/storefront/doctor/events` no longer returns today's ended events under «Будущие» or today's not-yet-ended ones under «Прошедшие»; a bare `GET /v1/public/events?timeframe=…` returns the horizon page, not the first 20-card cursor page (send `limit` for a cursor page).
  - `@ds/schemas`: `DoctorEventsLiveStripSchema`, `DoctorEventsLiveReadSchema`, the `DoctorEventsLive*` types and `DOCTOR_EVENTS_LIVE_REFRESH_SECONDS` are removed; `UpcomingBroadcastCardSchema` requires `kind`, `format` and `signUpCount`; `DoctorEventsFeedSchema` and the listing `horizon` require `nextBatch`; `RecordingProjectionSchema` requires `durationSec`; `PublicEventListingQuerySchema.limit` has no default.

- [#2922](https://github.com/doctor-school/ds-platform/pull/2922) [`6040122`](https://github.com/doctor-school/ds-platform/commit/6040122fdbe6d98643612e1a3ad851b0861257a0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - An event can hide its registrant count (007 EARS-12, 019 EARS-19, [#2913](https://github.com/doctor-school/ds-platform/issues/2913)). Migration `0048` adds `events.hide_sign_up_count boolean not null default false` (every existing event keeps showing its count). `CreateEvent` accepts `hideSignUpCount` (default `false`), `UpdateEvent` sets it only when the key is present, and `EventAdminDetail` returns its state — no admin read carries the count itself. While it is on, every public card read serves `signUpCount: null` and does not count the event at all: the Academy listing (`UpcomingBroadcastCardSchema`, upcoming and past, and the bare `/v1/public/events` read) and the doctor feed that the 018 nearest-events block also reads (`DoctorEventCardSchema`). Breaking: both `signUpCount` fields are now `number | null`; the `events-storefront` card model follows, and a `null` count hands the shared card no count line and no label.

- [#2610](https://github.com/doctor-school/ds-platform/pull/2610) [`bb4b540`](https://github.com/doctor-school/ds-platform/commit/bb4b540302e36d4edace761fe5e68e96932cdecd) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Each event now carries an audience and a kind from an editable dictionary
  (012 EARS-25…30, [#2509](https://github.com/doctor-school/ds-platform/issues/2509)). The audience — doctors or market experts — alone
  decides the storefront: doctors' events show only on the doctor storefront,
  experts' events only on the Academy, in every public read. The kind (Вебинар,
  Эфир, Конгресс, Встреча клуба, Мастер-класс, and any kind an editor adds in the
  admin «Типы мероприятий» screen) allows a set of participation formats; the
  admin event form offers only the formats the chosen kind allows, and narrowing
  a kind while its events use a removed format is refused with those events
  named. A project carries a default audience that prefills a new linked event.
  Breaking API contract: creating an event requires `kindId` and `audience` (plus
  a `participationFormat` the kind allows); creating a project requires
  `defaultAudience`. The doctor storefront card shows the event's kind title.
  Migration 0046 maps the existing events per the reviewed table and removes five
  test events.

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

- [#2663](https://github.com/doctor-school/ds-platform/pull/2663) [`9388284`](https://github.com/doctor-school/ds-platform/commit/9388284e74a18eeb87478fc8ccc405a7caf631c9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - «Мои события» on both hosts ([#1972](https://github.com/doctor-school/ds-platform/issues/1972)): every `MyEventItem` now carries `roomHref` — the calling host's room path for a registered row on a live event, otherwise `null` — and `participationFormat`, the event's attendance mode. `GET /v1/me/events` resolves the Academy room (`/webinars/<slug>/room`); the new `GET /v1/storefront/doctor/me/events` serves the same read for the doctor storefront (`/events/<slug>/room`), with the same `doctor_guest` posture.

- [#3053](https://github.com/doctor-school/ds-platform/pull/3053) [`ba5c902`](https://github.com/doctor-school/ds-platform/commit/ba5c902323c279cba67e535cc431bc7c89ead8e1) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Event page wave 3 ([#2072](https://github.com/doctor-school/ds-platform/issues/2072)), the read contract of the social proof and the viewers count, on both hosts at once: `GET /v1/public/events/:idOrSlug` and `GET /v1/storefront/doctor/events/:idOrSlug` carry `signUps: { total, sameSpecialty, adjacentSpecialties } | null` and `viewers: number | null`. `signUps.total` is the same colleagues' count the feed and listing cards carry as `signUpCount`; `sameSpecialty` counts registrants whose profile specialty owns one of the event's directions and `adjacentSpecialties` those who reach one through the managed direction adjacency instead. `signUps` is `null` at zero colleague sign-ups and while the event's «Скрыть число записавшихся» option is on. `viewers` is the number of distinct doctors who were in the event's room, `null` unless the event has ended and that number is above zero. Both are the same for a guest and a signed-in reader.

  **Breaking:**

  - `@ds/schemas`: `EventPageViewSchema` (and `EventPageViewBaseSchema`) require `signUps` (`SignUpProofSchema`, whose `total` is positive) and `viewers` (a positive whole number); each is `null` when absent, never omitted.

- [#2757](https://github.com/doctor-school/ds-platform/pull/2757) [`423dd7d`](https://github.com/doctor-school/ds-platform/commit/423dd7d9151d4d078c6d4c6df040ef5c75acb90e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress roster sort (044 EARS-22, narrowed by EARS-37): `GET /v1/admin/events/:idOrSlug/roster` accepts `sort` (`fullName`, `specialty`, `city`, `phone`, `registeredAt`, `presence`) and `dir` (`asc`/`desc`), composable with `q`, the presence filter and the page. Text columns order under the Russian collation with empty cells last, the phone by its normalised digits, `presence` by the mark of `attendanceDay` (required with that key, 400 otherwise); without `sort` the order stays registration date ascending. `@ds/schemas` exports `CONGRESS_ROSTER_SORT_KEYS`, `CONGRESS_ROSTER_SORT_DEFAULT` and the sort key/direction schemas.

- [#2809](https://github.com/doctor-school/ds-platform/pull/2809) [`9bce5b4`](https://github.com/doctor-school/ds-platform/commit/9bce5b49b6ae7849ed003fcb4c145fba052eec77) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 044 EARS-23 — the congress roster route (`GET /v1/admin/events/:idOrSlug/roster`) takes server-side per-column filters, each composable with the search, the presence filter, the sort and the page: `name`, `workplace`, `email` (case-insensitive contains), `phone` (contains on digits against the normalised number, `8 …` finds `+7 …`), `city` and `region` (case-insensitive equality with the directory value), `specialtyId` (directory id), `mailStatus` (`sent` / `failed` / `none`) and `registeredFrom` / `registeredTo` (inclusive Moscow calendar days). `CongressRosterQuerySchema` declares them; the generated client carries them ([#2317](https://github.com/doctor-school/ds-platform/issues/2317)).

- [#2851](https://github.com/doctor-school/ds-platform/pull/2851) [`d343086`](https://github.com/doctor-school/ds-platform/commit/d34308684b0abd775bd38a6d79f8535a19d3ca53) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 044 EARS-31 — every congress roster row (`GET /v1/admin/events/:idOrSlug/roster`) carries the EARS-30 `possibleDuplicate` marker, and the route takes `possibleDuplicate=yes|no` (absent = any, anything else 400) as one more conjunct composing with the search, the column filters, the sort and the page. The marker is derived over the whole event's participants before any filter applies, so the row, the filter and the participant card never disagree; a staff account's registration never marks a participant ([#2456](https://github.com/doctor-school/ds-platform/issues/2456)). `CongressRosterQuerySchema` / `CongressRosterRowSchema` declare it; the generated client carries it ([#2328](https://github.com/doctor-school/ds-platform/issues/2328)).

- [#2719](https://github.com/doctor-school/ds-platform/pull/2719) [`8350915`](https://github.com/doctor-school/ds-platform/commit/835091584a7a9f2e44a3e5dbbc70bd27e7b17495) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 046 programme committee ([#2437](https://github.com/doctor-school/ds-platform/issues/2437)): the `congress-program-committee` role (TOTP, bound to one or more events by migration 0047), the event-scoped submission registry, card and status change with the committee letters and the three-working-day revision deadline, and the platform administrator's deadline extension (ADR-0001 A3).

- [#3046](https://github.com/doctor-school/ds-platform/pull/3046) [`44902f9`](https://github.com/doctor-school/ds-platform/commit/44902f9e0b23af2eb8e3227ed78392f3afaa891d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Staff are participants, not statistics ([#2518](https://github.com/doctor-school/ds-platform/issues/2518)): a staff account's registration now appears in the congress roster (`GET /v1/admin/events/:idOrSlug/roster` — rows, total and the «возможный дубль» population), and the roster takes `hideStaff=true` to leave staff out of all three. The admin roster's «Все фильтры» panel carries the «Скрыть сотрудников» switch (off by default, kept in the address, shown as a chip). The storefront sign-up count, the room's online count and presence minutes still exclude staff. `RegistrationService.eventRoster` / `RegistrationRepository.findEventRoster` take a required `{ excludeStaff }`.

- [#2572](https://github.com/doctor-school/ds-platform/pull/2572) [`de024c9`](https://github.com/doctor-school/ds-platform/commit/de024c9daecee663cc52a498712e7641e18759fb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - One email code (003 EARS-41/34/23): `/verify`, `/login/otp` and the new doctor-host `/v1/storefront/doctor/verify` accept one emailed code whatever the account state — an unverified address is verified by it and signed in (session cookie set), its pre-verification password replaced by the registration step's or invalidated on sign-in by code. A registration onto an existing address sends a link-free code mail instead of the account-exists notice; the ticked consents the account lacks are recorded only after the code is accepted, never overwriting a held one. `MAILER_PORTAL_BASE_URL` is retired — no mail carries a portal link.

- [#2641](https://github.com/doctor-school/ds-platform/pull/2641) [`1e18f3f`](https://github.com/doctor-school/ds-platform/commit/1e18f3fcad2965d8494fba1339d170eddc8d06d2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress sign-in hand-off (003 EARS-44, 044 EARS-39): an accepted `POST /v1/congress/sign-up` now answers `{status:"accepted", handoff}` — an opaque 32-byte random reference, the same shape for new, existing and repeat submissions; only its SHA-256 is kept in Redis for 24 h. The new public `POST /v1/auth/login/otp/handoff {ref}` (no captcha, EARS-13 limits, timing-equalized) sends the account's login code as a code request does and returns the address; a reference redeems at most three times, and a missing, malformed, unknown, expired or exhausted one gets the one `handoff_refused` answer with no mail.

- [#2771](https://github.com/doctor-school/ds-platform/pull/2771) [`0b41632`](https://github.com/doctor-school/ds-platform/commit/0b41632eda3cdbbf574fe202624bbdf6b1e754e3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - «Прошедшие» on both storefronts pages by count, not by 14-day windows (019 «Amendment — 2026-10-12», [#2768](https://github.com/doctor-school/ds-platform/issues/2768)): the bare «Прошедшие» read of `GET /v1/public/events?timeframe=past` and `GET /v1/storefront/doctor/events?tense=past` opens on the 10 most recent past events that match the facets, however old, and every `nextFrom` takes in the next 10 older ones (the last step the remainder), in whole МСК days; the control reads «Показать ещё 10 (осталось N)». «Будущие» keeps its day horizon and «Показать ещё N из M». The head subline «N эфиров · M школ» counts the open tab — on «Прошедшие» the past events and their schools — and is not rendered for a tab with no events. The month view on «Прошедшие» without an explicit month opens on the month of the latest past event under the facets.

  **Breaking:**

  - `@ds/schemas`: `PublicEventListingCountsSchema` requires `pastSchools`, the distinct schools among the past listing-eligible events; `DOCTOR_EVENTS_FEED_PAST_STEP_EVENTS` (10) is the «Прошедшие» step.

- [#2787](https://github.com/doctor-school/ds-platform/pull/2787) [`d2df276`](https://github.com/doctor-school/ds-platform/commit/d2df276fae7fa13cedbd6c3ba22a628908b7b1d0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A signed-in user can confirm a phone number from `/account` ([#2774](https://github.com/doctor-school/ds-platform/issues/2774)): `POST /v1/me/phone` sends a six-digit code by SMS through the IdP, `POST /v1/me/phone/confirm` makes the number the account's confirmed phone and emails a security notice. A phone signs in and resets only while it is confirmed, and `GET /v1/me/profile` suggests the phone from the latest congress registration (`suggestedPhone`). A number confirmed on another account gets the ordinary answer and no SMS, so the surface reveals no registered numbers.

- [#2889](https://github.com/doctor-school/ds-platform/pull/2889) [`477fb14`](https://github.com/doctor-school/ds-platform/commit/477fb1436b9796becaf35b3f390576afc2e15bc0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The doctor events feed falls back to every specialty when the doctor's default «Моя и смежные» — own specialty plus adjacent areas — has no events (019 LD-9, EARS-9, [#2871](https://github.com/doctor-school/ds-platform/issues/2871)); a doctor whose own specialty is empty but whose adjacent areas have events keeps «Моя и смежные». When the read names no specialty scope and the remembered specialty's directions and their adjacent ones carry no upcoming doctors-audience event, `GET /v1/storefront/doctor/events` (and the month reads) answer with `targeting.mode: "all"`; an explicit `specialty` in the request is honoured as before. The new `targeting.defaultScopeEmpty` describes the visitor, not the query: every read reports it, whatever scope the request names. `DoctorEventsFeedQuerySchema.specialty` and the month query's `specialty` are optional with no default, so an absent scope is distinguishable from an explicit «Моя и смежные». The shared facet panel shows «Все специальности» selected under the fall-back as this visitor's default: `EventsFilter` takes `defaultSpecialtyScope` and `countAppliedFacets` an `AppliedCountOptions`, so the default scope is counted in neither «Применено: N» nor «Фильтры (N)» and «Сбросить» appears only for a facet beyond it. For this visitor an explicit `specialty=all` is the default too (uncounted, left out of the URL), while «Моя и смежные» is a narrowing: counted with «Сбросить», written as `specialty=mine-and-adjacent` and kept across later facet changes, so the fall-back does not take it back. Removing the last picked specialty returns to the visitor's default scope (`EventsFilter` uses `defaultSpecialtyScope`), and `hasAppliedFacets` / the empty state treat only that default as no facet. In the no-match state, a picked specialty whose removal falls back to every specialty is passed over — no «Показать смежные специальности» — and the next applied facet is weakened (`WidenMatching` now answers a `WidenRead`).

- [#2921](https://github.com/doctor-school/ds-platform/pull/2921) [`ca8b0ec`](https://github.com/doctor-school/ds-platform/commit/ca8b0ec7ef2229680f7ac3893cc5329528b6539c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Staff access (047 EARS-1…EARS-6, EARS-8, EARS-9 grant half): `GET /v1/admin/staff-access` lists every holder of a grantable staff role, one row per person, role and event, reading every page of the IdP grant search; `POST /v1/admin/staff-access/grants` (`platform_admin`, live revalidation, `stepUp`) finds or creates the account, adds the role to its existing IdP grant, writes the event binding and the `auth.role.granted` row, and returns a one-time temporary password for a new account or one without a password; an existing account whose email was never verified is refused with `409 STAFF_GRANT_EMAIL_UNVERIFIED` and nothing changed. An email that more than one IdP account holds is refused with `409 STAFF_GRANT_EMAIL_AMBIGUOUS` and nothing changed. Grants for one email are serialized under a per-email advisory lock. A stale second factor answers `STEP_UP_REQUIRED` with `stepUpUrl: "/mfa/challenge?mode=reverify"`; `POST /v1/admin/auth/mfa/reverify` refreshes the session's second factor in place and appends `auth.step_up.*` rows. `@ds/schemas` exports the staff-access and reverify contracts; `@ds/db` adds the event-grant list and insert helpers.

- [#2953](https://github.com/doctor-school/ds-platform/pull/2953) [`8735745`](https://github.com/doctor-school/ds-platform/commit/8735745144c3cee0815777dd4f72cce6d331e3e0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Staff access revocation (047 EARS-7…EARS-9): `POST /v1/admin/staff-access/revocations` (`platform_admin`, live revalidation, `stepUp`) takes `{userId, role, eventId?}`, ends every admin session and pending admin sign-in of the person, removes the role at the IdP (and the IdP grant itself when it was the grant's last role), deletes the event binding and appends the `auth.role.revoked` row; it answers `204`. Refusals: `403 REVOKE_SELF_PLATFORM_ADMIN` (the caller's own platform-administrator role), `409 REVOKE_ALREADY_COMPLETE` (a role the person does not hold — nothing changed), `401 STEP_UP_REQUIRED`, `400`, and `503` when the IdP fails after the sessions were already ended. `@ds/db` adds the event-binding delete helper; the SDK is regenerated.

- [#3200](https://github.com/doctor-school/ds-platform/pull/3200) [`0212f80`](https://github.com/doctor-school/ds-platform/commit/0212f80678da2fb087688192404cf0c5447f1521) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The sign-in host's API (003 EARS-5/24/44/60/64/66–71, ADR-0015 §4, [#3170](https://github.com/doctor-school/ds-platform/issues/3170)):
  `/v1/sign-in-host/*` reads a Zitadel auth request, picks the storefront by
  `client_id`, runs the storefront's own sign-in, code, registration and reset
  steps under the same guards, and keeps one shared browser session per browser
  (`sign_in_host_records`, sealed at rest, 30-day lifetime, 7-day idle). Revoking
  every session of a person (reset, first verification) now also ends their
  sign-in-host records. Disabled (404) until the whole configuration block is set.

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

- [#2910](https://github.com/doctor-school/ds-platform/pull/2910) [`2680028`](https://github.com/doctor-school/ds-platform/commit/26800282aa5c1ec2e30bc099b836f8aab06b9c18) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The doctor «Идёт сейчас» strip follows the whole applied filter set — the
  specialty scope and every facet the feed below it reads (019 «Amendment —
  2026-10-13», [#2907](https://github.com/doctor-school/ds-platform/issues/2907)) — so it no longer shows on a page load and then vanishes on
  its first refresh, and never shows a live event the feed's facets hide.

  `GET /v1/storefront/doctor/events/live` takes the feed's facet query
  (`specialty` — `mine-and-adjacent` by default, `all`, or a pick — and `format`,
  `kind`, `city`, `nmo`, `free`, `q`), decoded by the new
  `parseDoctorEventsLiveQuery` in `@ds/schemas` (the month query's facet half),
  and selects through the feed's own predicate. In `@ds/events-storefront`,
  `fetchEventsLive(liveHref, config, session, request)` now carries the guest's
  remembered-specialty relay cookie like the feed read (breaking signature
  change); `LiveSection` takes the page's `raw` query and `request`; the server
  render and the client refresh read the one href built by `liveReadHref`, the
  block is keyed by it, and a new server answer replaces the held one.

  The Academy strip follows the Academy's applied facets by the same rule:
  `GET /v1/public/events/live` takes `project`, `expert` and `topic`, decoded by
  the Academy facet codec and narrowed by the listing's own facet predicate, and
  `liveReadHref` carries each host's facet keys.

### Patch Changes

- [#2727](https://github.com/doctor-school/ds-platform/pull/2727) [`5922a37`](https://github.com/doctor-school/ds-platform/commit/5922a373daa5fd617f2b3076cf7ea9be97f4c32b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Events storefront wave 2 ([#2028](https://github.com/doctor-school/ds-platform/issues/2028)), the read contract of the month view and the facet panel on both hosts. The Academy reads take the 014 facets Проект, Эксперт, Тема as the repeatable slug lists `project`, `expert`, `topic` of the one listing codec (`ACADEMY_EVENT_FACETS_QUERY_CODEC`, `parseAcademyEventFacets`): `GET /v1/public/events?timeframe=…`, `?month=YYYY-MM` and `/month-counts?year=YYYY` narrow alike — values of one facet OR together, the facets AND together; a malformed slug is a 400, a slug nothing carries reads empty, and a facet on the bare legacy read is a 400. A horizon listing page carries the additive `facets { project, expert, topic }` options block (`{ slug, title, count }`, each counted under the other facets; zero-yield options stay listed at 0). The doctor storefront gains `GET /v1/storefront/doctor/events/month-counts?year=YYYY` with the month read's facets and posture, answering the Academy `MonthlyEventCount[12]`. The doctor month read `GET /v1/storefront/doctor/events/month` now covers the whole month — past days count their ended events — and carries `entries`, the month's events in the Academy `MonthBroadcastEntry` shape (the month grid's pills). The doctor feed `GET /v1/storefront/doctor/events` carries the additive `facets { city, kind }` options block in the same `{ slug, title, count }` item shape (counted under the other doctor facets over the tense's reach; a city option's `slug` is the city value). Every `MonthBroadcastEntry` (the Academy `?month=` read and the doctor month `entries`) gains `participationFormat`, so a month pill states its time in the viewer's zone like the feed card (offline in МСК). Both feed reads carry the api's «сегодня» as `today` (`YYYY-MM-DD`, МСК, the doctor month read's field): the doctor feed at the top level, the Academy horizon page inside `horizon` — the events page takes its one today from the read it renders with.

- [#2952](https://github.com/doctor-school/ds-platform/pull/2952) [`68eda66`](https://github.com/doctor-school/ds-platform/commit/68eda66a9527bc38218da64bcb10097451d856f6) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A signed-in visitor opening their own congress sign-in link is now redirected by the server straight to the account, with no login page shown. The api gains a read-only `POST /v1/auth/login/otp/handoff/own` check (session required; never redeems the link or sends a code).

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
