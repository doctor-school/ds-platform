# @ds/api-client

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
