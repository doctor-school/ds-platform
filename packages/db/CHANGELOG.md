# @ds/db

## 3.0.0

### Major Changes

- [#1891](https://github.com/doctor-school/ds-platform/pull/1891) [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-24 — the schema drops the free-text speaker storage. The
  `eventSpeakers` table definition is gone from `src/schema/events.ts`,
  `legacySpeakerId` is gone from the `event_experts` link in
  `src/schema/taxonomy.ts`, and `src/schema/speaker-migration.ts` — the phase
  enum and cutover table of the withdrawn staged design — is deleted. Migration
  `0036_speaker_cutover.sql` performs the drops in one release.

  BREAKING: `event_speakers` and `event_experts.legacy_speaker_id` no longer
  exist; anything reading them must source the line-up from `event_experts`.

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

- [#1705](https://github.com/doctor-school/ds-platform/pull/1705) [`654f3ba`](https://github.com/doctor-school/ds-platform/commit/654f3baaf2dd8772de1820e2199baa982d539102) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 007/014 — optimistic concurrency on admin event writes: `events.version` + `ETag` / `If-Match`

  The six admin state-changing commands (`publish`, `open`, `close`, `archive`, `mark-ended`, bare `transition`) now REQUIRE an `If-Match` validator. A request without one is refused `428 PRECONDITION_REQUIRED`; an unparseable or stale validator is refused `412 PRECONDITION_FAILED`. Every admin event read/write that returns a detail (`create`, `detail`, `PATCH`, `PUT :id/stream`, all six transitions) emits `ETag: W/"<version>"`, and the detail body carries `version`.

  Bump rationale (`repo-conventions.md` → Bump letter, "unsure → major"): `@ds/api` **major** — an existing successful call becomes a `428` for any client that does not send the header, and `412` is a new consumer-visible refusal on endpoints that previously had neither; that is a changed request contract, not an additive one. `@ds/schemas` **major** — `EventAdminDetailSchema` gains a required `version` field, so any producer of that shape must now supply it. `@ds/db` **minor** — `events.version integer not null default 1` is purely additive (migration `0031_events_version`), no existing column changed. `@ds/admin` **minor** — the lifecycle action bar now sends the rendered version as the validator, and the event detail surface follows the re-read a refusal triggers: the refusal alert clears itself once the state it describes has been replaced, and the edit + stream forms re-project from each refetched detail while keeping fields the operator has edited. Behaviour of the operator surface is unchanged when nobody else is editing.

- [#1807](https://github.com/doctor-school/ds-platform/pull/1807) [`5a8e03f`](https://github.com/doctor-school/ds-platform/commit/5a8e03f0746ffcc3b8fb7260d906785f4b7b9a0e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 EARS-1 — one shared event-page core: `EventPageView` (the 004 public projection widened in place with `format` and `seatsLeft`) is now read by both storefronts, the doctor host through the new `GET /v1/storefront/doctor/events/:idOrSlug` that delegates to the same service. Participation is a single server-resolved policy — `ParticipationCta` (`register` · `registered` · `enter-room` · `switch-to-online` · `sold-out` · `unavailable`) — served as a per-viewer sibling read on each host, so neither storefront branches on lifecycle, registration, format or seats of its own.

## 2.0.0

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

## 1.0.0

### Major Changes

- [#1622](https://github.com/doctor-school/ds-platform/pull/1622) [`e1b771f`](https://github.com/doctor-school/ds-platform/commit/e1b771fdeddc55990c67a5f903aba280d7d174b4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#1606](https://github.com/doctor-school/ds-platform/issues/1606): converge Expert authoring with an optional unique User link and replace
  the stored free-form Expert name with required family/given names plus optional
  patronymic. Expert display names and slugs are now server-derived, and mutation
  input no longer accepts a slug. Project, Partner, Expert and Direction slugs are
  stable system-owned identities with retained-row-safe collision suffixes and
  kind fallbacks when authored text has no transliterable base.

- [#1575](https://github.com/doctor-school/ds-platform/pull/1575) [`9ee8b78`](https://github.com/doctor-school/ds-platform/commit/9ee8b78b7b3c575a5cf8ae425517040baaaf8cae) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#1483](https://github.com/doctor-school/ds-platform/issues/1483) (ADR-0016 §2.8/§5): the curated `topics` book becomes `directions`, and the
  schema gains the two relations the 017 targeting resolution reads.

  BREAKING — a renamed table and renamed exports: `topics` → `directions`, with
  every exported symbol renamed to match. ADR-0016 §5 also names an `event_topics`
  join as following the rename; no such table exists in the shipped schema (events
  carry no direction join yet), so nothing was renamed for it.

  The rename is hand-written as a true SQL `RENAME` over the drizzle-kit diff —
  the generator offers only DROP + CREATE for a renamed table — and it renames every
  dependent constraint, index and trigger with it, so the
  retained-row lifecycle (`record_status`, [#1278](https://github.com/doctor-school/ds-platform/issues/1278)) and every existing row survive
  it; nothing is dropped and re-created.

  New: `direction_specialties` (directions ↔ the closed Минздрав nomenclature) and
  `direction_adjacency` (a DIRECTED self-relation carrying `kind` + `weight`), both
  with RESTRICTIVE foreign keys (ADR-0003) and the same lifecycle columns as every
  other retained-row table.

### Minor Changes

- [#1577](https://github.com/doctor-school/ds-platform/pull/1577) [`2d76e79`](https://github.com/doctor-school/ds-platform/commit/2d76e794ab7ef5d6ea937f2755d9819ef833042e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-6: a doctor's chosen specialty is remembered, and the platform keeps
  remembering it across sign-in.

  `@ds/db` gains the `(doctor, specialty, role)` link row (LD-1) with restrictive
  foreign keys, one primary specialty per doctor enforced by a partial unique
  index, the retained-row lifecycle columns, and an audit trigger — the choice is
  personal data with a recorded history, not a preference blob.

  `@ds/api` gains ONE command with two routes, because the ACTOR decides where the
  choice belongs and the actor is resolved from the request, never submitted:
  `POST /v1/public/specialty-choice` writes a guest's answer into the anonymous
  session, and `PUT /v1/me/specialty` writes a signed-in doctor's into the profile
  link row. Both are idempotent, both reject a reference that is not a member of
  the closed book, and «Другое» is a member like any other (LD-5). No client can
  name a subject, so no client can write another doctor's specialty.

  On the first authenticated read the sign-in cascade runs (LD-2): an anonymous
  choice is ADOPTED into an empty profile and DISCARDED when the profile already
  carries one — the profile always wins, with no prompt, no merge and no
  cross-device carry. `@ds/schemas` carries the shared `SpecialtyChoice` contract,
  where «resolved: nothing chosen» is a distinct answer from an unresolved read.

## 0.11.0

### Minor Changes

- [#1570](https://github.com/doctor-school/ds-platform/pull/1570) [`f1a6062`](https://github.com/doctor-school/ds-platform/commit/f1a606231c5c3c5ead47465023db479fb4d3b416) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-3 — the platform gains the closed Минздрав specialty reference book. A new `specialties_minzdrav` table is populated by a provenance-stamped seed from Приказ Минздрава России от 14.05.2026 № 435н (Раздел I, in force from 01.09.2026) plus the single «Другое» catch-all, and served by two public reads: `GET /v1/public/specialties` (the whole book with its own `total` — no count literal exists anywhere) and `GET /v1/public/specialties/frequent` (the ordered frequent subset the search-first catalog renders). `@ds/schemas` gains the `SpecialtyRef` / `SpecialtyBook` / `FrequentSpecialties` contracts, the `SPECIALTY_NOT_IN_BOOK` error code and the reusable `isSpecialtyBookMember` predicate; the book has no write path, and any specialty reference outside it is refused fail-closed with RFC 7807.

## 0.10.0

### Minor Changes

- [#1422](https://github.com/doctor-school/ds-platform/pull/1422) [`f81468d`](https://github.com/doctor-school/ds-platform/commit/f81468d52165898f8c7b1f0de553917f4d0ed18b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-4 — descriptive partner authoring vertical ([#1286](https://github.com/doctor-school/ds-platform/issues/1286))

  Additive across four packages, no breaking change to an existing export; the
  slice consumes the W1a ([#1283](https://github.com/doctor-school/ds-platform/issues/1283)) taxonomy foundation and the [#1284](https://github.com/doctor-school/ds-platform/issues/1284) expert
  precedent byte-for-byte rather than forking either.

  - `@ds/db`: the `partners` entity — slug grammar CHECK, canonical-UUID
    exclusion, the `partners_website_url_https` CHECK that admits only `https://`
    addresses, the set-once `first_published_at` trigger, the `partners_audit`
    mirror and a `pg_trgm` GIN index over `title`/`slug` for operator search.
  - `@ds/schemas`: partner DTOs (create/update/list/detail) — a title, an optional
    https-only website address and the permanent public identity, with `.strict()`
    refusing the bio/description fields a partner does not have. The website
    validator is a single exported pattern, the exact twin of the DB CHECK, so one
    rule governs both edges.
  - `@ds/api`: `GET/POST /v1/admin/partners` and `GET/PATCH /v1/admin/partners/:id`
    — multipart `logo` through the shared still-image normalizer, fenced
    idempotency, ETag/If-Match concurrency, RFC 7807 problems and audit writes.
  - `@ds/admin`: the `partners` resource — list on the shared taxonomy list shell,
    tabbed create/detail with «Основное», the generated-slug preview that is
    editable until the first publication, and the logo dropzone with upload /
    replace / clear. Unlike an expert, a partner has no initials fallback: an
    empty logo slot stays empty, because a partner's mark is the brand's, not a
    derivation of its name.

- [#1420](https://github.com/doctor-school/ds-platform/pull/1420) [`1d1be8f`](https://github.com/doctor-school/ds-platform/commit/1d1be8f5f4787214ce740eb46f4c6976112ab647) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Retained-row lifecycle: `record_status`/`deleted_at` on events, event speakers, stream config, registrations and users, all cascade FKs turned RESTRICT, and the event-edit/seed write paths now retire and restore rows instead of deleting them.

- [#1427](https://github.com/doctor-school/ds-platform/pull/1427) [`2226016`](https://github.com/doctor-school/ds-platform/commit/222601672d17079eb06914a34dd894b6993dc4c3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-7 — explicit expert-to-legacy-speaker matching ([#1289](https://github.com/doctor-school/ds-platform/issues/1289))

  Additive across four packages, no breaking change to an existing export; the
  slice binds the taxonomy `experts` entity to the legacy `event_speakers` rows an
  event already carries, so an event's line-up stops being two disconnected lists.

  - `@ds/db`: the `event_experts` link table with the `relationship_status`
    (`active|retired`) enum, the composite FK that keeps a matched legacy speaker
    inside its own event, the eligibility-blind partial unique index that reserves
    one `(event_id, position)` slot per active link, and the `event_experts_audit`
    mirror. Rider: nullable `event_speakers.content_removed_at` (additive, no
    backfill).
  - `@ds/schemas`: the link DTOs — create/update/list/detail with `role` 1–80
    trimmed, `position` 0–32767 and a nullable `legacySpeakerId`.
  - `@ds/api`: `GET/POST /v1/admin/event-experts`, `GET/PATCH
/v1/admin/event-experts/:id` and the `retire`/`restore` transitions — fenced
    idempotency, weak-ETag `If-Match` concurrency, the §2.3 lock protocol over the
    candidate link set, RFC 7807 problems and audit writes. An occupied slot now
    answers 409 `SPEAKER_POSITION_OCCUPIED` on both the application pre-check and
    the constraint edge, never an unclassified 500.
  - `@ds/admin`: the «Эксперты» tab on the event card — link an expert with a role
    and a running-order position, see matched/unmatched against the legacy
    speakers at a glance, and clear a stale match (unmatch); retire hides a link
    from the line-up without deleting it, restore brings it back. Picking a legacy
    speaker to CREATE a match ships with [#1426](https://github.com/doctor-school/ds-platform/issues/1426) (it needs the [#1306](https://github.com/doctor-school/ds-platform/issues/1306) speakers read).

- [#1429](https://github.com/doctor-school/ds-platform/pull/1429) [`d388a70`](https://github.com/doctor-school/ds-platform/commit/d388a70455b8c04eb9fe69fbb534da2765fe25a5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-6 — retained event↔project relationships with the §3.1 lifecycle-impact gate ([#1288](https://github.com/doctor-school/ds-platform/issues/1288))

  Additive across four packages, no breaking change to an existing export. This is
  the FIRST join vertical of feature 012, so it also authors the shared
  preview→confirm seam every later relationship ([#1290](https://github.com/doctor-school/ds-platform/issues/1290)–[#1296](https://github.com/doctor-school/ds-platform/issues/1296)) reuses.

  - `@ds/db`: the `event_projects` join table — the logical pair unique across
    ACTIVE AND RETAINED rows (a retired relation is RESTORED, same row and id,
    never re-inserted), both FKs `RESTRICT`, the `retired ⇔ deleted_at` CHECK, a
    reverse-direction index for the project-side traversal and the
    `event_projects_audit` mirror. `withAuditContext` / `withRequestAuditContext`
    gained an optional transaction-config passthrough so a confirmation can open
    its transaction SERIALIZABLE.
  - `@ds/schemas`: the relationship DTOs — create/list/detail, the two public
    summary shapes with their cursor page envelopes, and the `LifecycleImpact`
    preview contract. Every public DTO is `.strict()`.
  - `@ds/api`: `GET/POST /v1/admin/event-projects`, `GET
/v1/admin/event-projects/:id`, its `lifecycle-impact` preview and the
    `retire`/`restore` transitions — fenced idempotency, weak-ETag `If-Match`
    concurrency, a signed single-transition impact token, a SERIALIZABLE
    confirmation and RFC 7807 problems. Plus both public traversals:
    `GET /v1/public/events/:idOrSlug/projects` and
    `GET /v1/public/projects/:idOrSlug/events`. There is no PATCH and no DELETE —
    the join carries no mutable attribute and nothing here is ever physically
    removed.
  - `@ds/admin`: the «Проекты» tab on the event card (authoring, retire, restore)
    and the read-only «События» view on the project card, both served by one
    panel. Retiring or restoring a link opens a dialog that first shows WHICH
    public pages the change would affect and only then accepts the confirmation;
    if the situation moved while the operator was reading it, the preview reloads
    instead of the action going through on stale information.

  Deploy note: `LIFECYCLE_IMPACT_TOKEN_SECRET` must be set in the production and
  stand environments before this ships — the impact service fails closed without
  it.

## 0.9.0

### Minor Changes

- [#1414](https://github.com/doctor-school/ds-platform/pull/1414) [`f17dca0`](https://github.com/doctor-school/ds-platform/commit/f17dca0366368a3b59dedb6e8c7aa604081eaca5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-3 — curated topic authoring vertical ([#1285](https://github.com/doctor-school/ds-platform/issues/1285))

  Additive across four packages, no breaking change to an existing export; the
  slice consumes the W1a ([#1283](https://github.com/doctor-school/ds-platform/issues/1283)) taxonomy foundation and the [#1284](https://github.com/doctor-school/ds-platform/issues/1284) expert
  precedent byte-for-byte rather than forking either.

  - `@ds/db`: the `topics` entity — slug grammar CHECK, canonical-UUID exclusion,
    the set-once `first_published_at` trigger, the `topics_audit` mirror and a
    `pg_trgm` GIN index over `title`/`slug` for operator search.
  - `@ds/schemas`: topic DTOs (create/update/list/detail) — the thinnest of the
    four entities: a title (1–120, trimmed) plus its permanent public identity,
    with `.strict()` refusing the description/media fields a topic does not have.
  - `@ds/api`: `GET/POST /v1/admin/topics` and `GET/PATCH /v1/admin/topics/:id`
    — JSON-only writes (no media part anywhere), fenced idempotency,
    ETag/If-Match concurrency, RFC 7807 problems and audit writes.
  - `@ds/admin`: the `topics` resource — list on the shared taxonomy list shell,
    tabbed create/detail with «Основное», and the generated-slug preview that is
    editable until the first publication. The data provider's resource map now
    admits a resource with NO file part, so a topic write can never be shaped as
    multipart.

- [#1381](https://github.com/doctor-school/ds-platform/pull/1381) [`1789e78`](https://github.com/doctor-school/ds-platform/commit/1789e785c2e129a8876389215cf67e9a8d72bb63) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 014 EARS-1..2: retained event recordings — attach, publish, unpublish, retire and restore a recording on its own lifecycle, independent of the event's; the admin event detail becomes tabbed and gains a «Записи» tab plus the «запись ожидается к» readiness date; `@ds/design-system` gains the `Dialog` / `AlertDialog` element class.

## 0.8.0

### Minor Changes

- [#1379](https://github.com/doctor-school/ds-platform/pull/1379) [`717921a`](https://github.com/doctor-school/ds-platform/commit/717921ab7da5745cff5f833bbbc049736b6a96d3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-2 — expert authoring vertical ([#1284](https://github.com/doctor-school/ds-platform/issues/1284))

  Additive across four packages, no breaking change to an existing export; the
  slice consumes the W1a ([#1283](https://github.com/doctor-school/ds-platform/issues/1283)) taxonomy foundation byte-for-byte rather than
  forking it.

  - `@ds/db`: the `experts` entity — slug grammar CHECK, canonical-UUID
    exclusion, the set-once `first_published_at` trigger, a tombstone-ready
    `content_removed_at` column, the `experts_audit` mirror and a `pg_trgm` GIN
    index over `name`/`slug` for operator search.
  - `@ds/schemas`: expert DTOs (create/update/list/detail), the shared
    `expertInitials` derivation and the 012 error codes the surface can raise.
  - `@ds/api`: `GET/POST /v1/admin/experts` and `GET/PATCH /v1/admin/experts/:id`
    — multipart `photo` through the shared still-image normalizer, fenced
    idempotency, ETag/If-Match concurrency, RFC 7807 problems and audit writes.
  - `@ds/admin`: the `experts` resource — list on the shared taxonomy list shell,
    tabbed create/detail with «Основное», the generated-slug preview and the
    deterministic-initials `Avatar` fallback when an expert has no photo. The
    data provider now dispatches its media part off a resource map instead of a
    hardcoded `projects` branch.

## 0.7.0

### Minor Changes

- [#1356](https://github.com/doctor-school/ds-platform/pull/1356) [`fde1591`](https://github.com/doctor-school/ds-platform/commit/fde1591457f63310d24ad5867b08695c7c263da2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-1 — project authoring vertical ([#1283](https://github.com/doctor-school/ds-platform/issues/1283))

  Additive across five packages, no breaking change to an existing export:

  - `@ds/db`: the `projects` entity, the extended retained `idempotency_keys`
    contract and `media_cleanup_jobs`, all with DB-enforced retained lifecycles.
  - `@ds/schemas`: taxonomy DTOs, the exact 012 `errorCode` set, the idempotency /
    ETag protocol helpers and the shared canonical slugifier.
  - `@ds/api`: `GET/POST /v1/admin/projects`, `GET/PATCH /v1/admin/projects/:id`,
    the fenced idempotency service, the shared still-image normalizer and the
    durable media-cleanup worker; the object-storage port gains an opt-in
    write-once PUT.
  - `@ds/design-system`: two new primitives — `Textarea` (with a
    no-truncation character counter) and `MediaDropzone`.
  - `@ds/admin`: the shared taxonomy admin list shell and the tabbed project
    detail/create surfaces.
  - `@ds/showcase`: catalogue entries for the two new primitives.

## 0.6.0

### Minor Changes

- [#1154](https://github.com/doctor-school/ds-platform/pull/1154) [`7355ade`](https://github.com/doctor-school/ds-platform/commit/7355adea6c7d76b471deecdee774f339ce049750) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add VK Video and CDNVideo to the webinar stream-provider enum end-to-end ([#1134](https://github.com/doctor-school/ds-platform/issues/1134)).

  The closed `STREAM_PROVIDERS` enum grows from `rutube | youtube` to
  `rutube | youtube | vk | cdnvideo` (all RU-reachable, embeddable providers),
  additively across every layer that reads the SSOT:

  - `@ds/schemas` — per-provider `EMBED_REF_SHAPES`: VK's `oid_id_hash` triple (the
    hash is mandatory and non-derivable) and CDNVideo's host-allowlisted player URL
    (`playercdn.cdnvideo.ru/aloha/players/`, an SSRF guard on the value the room
    drops into its `<iframe src>`). CDNVideo is the recorded stored-URL exception; the
    URL-shaped-paste guard is now provider-scoped so the id-style providers still
    reject a link.
  - `@ds/db` — the Postgres `stream_provider` enum gains `vk` + `cdnvideo` via an
    additive `ALTER TYPE … ADD VALUE` migration.
  - `@ds/portal` — the room resolves the VK `video_ext.php` embed from the triple and
    embeds the CDNVideo player URL verbatim; a provider-scoped direct watch URL is
    derived per provider.
  - `@ds/admin` — ConfigureStream offers all four providers with a per-provider embed
    reference hint and provider-named RU validation errors.

## 0.5.0

### Minor Changes

- [#797](https://github.com/doctor-school/ds-platform/pull/797) [`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Display-name SSOT + self-scoped `SetDisplayName` endpoint (006 EARS-14/16, [#705](https://github.com/doctor-school/ds-platform/issues/705)): the `users` mirror gains a nullable `display_name` column (no backfill), the SSOT for a doctor's «Имя и фамилия» collected just-in-time at first webinar-room entry — never at registration. A new `me` module serves two `authenticated` / `doctor_guest` / `fast-path` routes: `PUT /v1/me/display-name` (`SetDisplayName` — writes the trimmed, non-empty-after-trim, ≤100-char name via the `packages/schemas` `SetDisplayNameRequest` SSOT to the caller's OWN row) and `GET /v1/me/display-name` (the caller's own `{ displayName: string | null }`). Self-only by construction — no endpoint takes a target user id, so no caller reaches another doctor's name — and the display name never enters chat payloads (chat identity stays the non-PII author tag). New schema exports: `SetDisplayNameRequestSchema`, `MyDisplayNameSchema`, `DisplayNameSchema`.

## 0.4.0

### Minor Changes

- [#775](https://github.com/doctor-school/ds-platform/pull/775) [`54c0175`](https://github.com/doctor-school/ds-platform/commit/54c01754735186fd86c6bbbbf2649c343d84c8eb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Reconcile depth (EARS-19, [#753](https://github.com/doctor-school/ds-platform/issues/753)): the mirror-sync sweep now closes the full reconciliation depth deferred by 003. It resolves mirror-vs-Zitadel divergence **Zitadel-wins** on the identity fields (`email`/`phone`/`email_verified`/`phone_verified`) while preserving the mirror-owned `role`/`id`/`created_at`, and emits an `auth.reconcile.divergence` audit event naming only the changed field names (never the values). Users removed or deactivated in Zitadel have their mirror row **soft-deleted** (new nullable `users.deactivated_at`; rows are never hard-deleted so the audit trail survives) and are not re-granted `doctor_guest`; a user that reappears active is reactivated. `deactivated_at` is a projection flag, not an authz gate. The real `listUsers()` adapter now paginates in full and throws on failure so a partial/failed enumeration can never wipe the mirror.

## 0.3.0

### Minor Changes

- [#703](https://github.com/doctor-school/ds-platform/pull/703) [`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 [#690](https://github.com/doctor-school/ds-platform/issues/690) — realize deferred webinar-room header canvas elements (live presence count + live-duration)

  Realizes two of the four canvas header elements [#584](https://github.com/doctor-school/ds-platform/issues/584) deferred as tracked
  decision-debt, each now backed by real data (no faked/hardcoded values):

  - **Live presence count** («N врачей в комнате») — a server-side aggregate over
    the existing append-only `presence_beats`: the count of distinct doctors with a
    beat inside the freshness window (2 × the heartbeat cadence N). It rides the
    EARS-1 `RoomConfig` grant (initial value) and every heartbeat ack (live
    refresh), and the portal header renders it desktop-only per the canvas. An
    integer aggregate only — never per-doctor identity or the roster (EARS-8).
  - **Live-duration «· N мин»** on the live pill — counted from the event's actual
    go-live instant. Adds a nullable `events.live_at` column stamped once by 007
    `OpenRoom` (the `published → live` transition); the grant exposes it and the
    room counts elapsed minutes from it, never the scheduled `startsAt`. A legacy
    `live` row with no `live_at` renders the pill with no suffix (truthful).

  Additive schema growth (`RoomConfig.liveAt` + `RoomConfig.presenceCount`,
  `PresenceHeartbeatAck.presenceCount`) and one additive migration
  (`events.live_at`). The theme toggle (re-deferred to [#702](https://github.com/doctor-school/ds-platform/issues/702), dark theme with it)
  and the doctor avatar (no server-side display name exists — re-deferred) remain
  canvas omissions, never dead affordances.

## 0.2.0

### Minor Changes

- [#634](https://github.com/doctor-school/ds-platform/pull/634) [`ce4b05d`](https://github.com/doctor-school/ds-platform/commit/ce4b05dd06d5d0c2ed39e04b87f7cca2d396185b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-1 — logged-in one-tap RegisterForEvent command + record

  Lands the foundation of feature 005's write side (realizes US-1, US-3): the
  `doctor_guest`-authenticated `RegisterForEvent` command, the durable registration
  record, and the per-user `EventRegistrationState` read that flips to `registered`
  the moment the write lands. These are the **first authenticated `doctor_guest`**
  endpoints in the webinar domain.

  - `@ds/api` — new `registration` module. `POST /v1/events/:idOrSlug/registration`
    (`RegisterForEvent`) records a registration against the authenticated doctor's
    account in **one action** — no confirmation round-trip — for a `published`
    (upcoming) or `live` event, and returns the registered `EventRegistrationState`
    so the event page flips immediately. `GET /v1/events/:idOrSlug/registration`
    returns the caller's own `{ registered, registeredAt? }` state (private, never a
    shared cache). Both carry the **EARS-10** endpoint-authz classification
    `authenticated` / `doctor_guest` / `fast-path`: an unauthenticated caller is
    refused (401) and any non-`doctor_guest` role (403) — never a silent success.
    Gating reads the single `EventLifecycleState` (007, read-only): a
    non-`published`/`live` state is a 409, a missing event a 404.
  - `@ds/db` — new `registrations` table (`id, user_id → users`, `event_id →
events`, `registered_at`), migration `0007_registrations.sql`. No cancelled
    state in wave 1 (owner decision).
  - `@ds/schemas` — new `EventRegistrationState` read model + `REGISTRABLE_EVENT_STATES`
    / `isRegistrable` gating SSOT (the API contract shared with the portal via the SDK).

  The one-registration invariant (`UNIQUE (user_id, event_id)` + idempotent upsert,
  EARS-3), the terminal `audit_ledger` row (EARS-8), the broader per-user reads
  (EARS-4/6), the guest-through-auth event-context carry (EARS-2), and the
  ended/archived gating detail (EARS-9) are sibling handlers. Built and E2E-driven
  against seeded fixture events until feature 007 delivers authoring/transitions
  (tracked seam, parent [#564](https://github.com/doctor-school/ds-platform/issues/564)).

- [#636](https://github.com/doctor-school/ds-platform/pull/636) [`68c6f83`](https://github.com/doctor-school/ds-platform/commit/68c6f838648df6b5ecc0bf24d94cb1737cfba8a1) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-3 — one-registration invariant + idempotent RegisterForEvent

  Enforces the one-registration invariant (realizes US-1, US-5): one doctor + one
  event = **at most one** registration, regardless of how many times or through
  which path (one-tap, guest-through-auth, «мои события» re-entry) the doctor
  registers. A repeat is an **idempotent no-op** returning the existing
  registration — no duplicate row, no second `DoctorRegisteredForEvent`, no second
  `audit_ledger` entry (design §2/§5; ADR-0003 §5/§6).

  - `@ds/db` — `UNIQUE (user_id, event_id)` on `registrations`, migration
    `0008_registrations_unique.sql`. The migration **dedups any pre-existing
    duplicate rows first** (keeping the earliest `registered_at`, tie-broken on the
    lower `id`) before adding the constraint, so it applies cleanly on a database
    where EARS-1's pre-constraint insert could have accumulated duplicates
    (latent-only in pre-pilot). The invariant is enforced in the database, not by
    client discipline.
  - `@ds/api` — `RegisterForEvent` is now an idempotent `INSERT … ON CONFLICT
(user_id, event_id) DO NOTHING` + read-back keyed on the constraint, correct
    under the insert-race (one inserts, the other reads back — never a duplicate nor
    a lost registration). On the **first insert only** it appends exactly one
    terminal `audit_ledger` row (`webinar.registration.created`, the durable
    `DoctorRegisteredForEvent`; opaque subject + ids only, no PD), in the same
    transaction as the insert; an idempotent repeat appends none — the
    exactly-one-then-none invariant. Both first insert and repeat return
    `{ registered: true, registeredAt }`.

  The terminal audit row is landed here (not EARS-8) because its
  exactly-one-on-first-insert / none-on-repeat guarantee is a direct consequence of
  the `ON CONFLICT` insert/conflict discrimination that is EARS-3's core — design §5,
  the Invariants, and the EARS-3 AC all assign it to the register command's first
  insert. EARS-8 ([#572](https://github.com/doctor-school/ds-platform/issues/572)) now owns the `EventRoster` read model plus the no-PII
  cross-check on top of the record. Built and E2E-driven against seeded fixture
  events until feature 007 delivers authoring/transitions (tracked seam, parent
  [#564](https://github.com/doctor-school/ds-platform/issues/564)).

- [#683](https://github.com/doctor-school/ds-platform/pull/683) [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-4 — server-authoritative heartbeat presence capture (append-only)

  While a gated doctor is in a live room with the tab visible, the client posts an
  authenticated heartbeat immediately on entry and visible resume, then every N
  seconds; the backend appends each accepted beat to a durable append-only
  Postgres table — the durable basis for the per-doctor sponsor minutes (feature
  006, EARS-4; realizes US-3).

  - `@ds/schemas` — new `PresenceHeartbeatAckSchema` (`{ eventId, beatAt }`): the
    server-authoritative ack of one accepted beat. `beatAt` is the server-stamped
    instant the row was appended, never a client-supplied count/timestamp — a
    client cannot inflate its own presence (requirements Constraints).
  - `@ds/db` — new append-only `presence_beats` table `(id, user_id, event_id,
beat_at)` (ADR-0003 §3). Immutable rows (no mutable column → nothing to update
    in place); `beat_at` defaults to the server clock; a composite
    `(event_id, user_id, beat_at)` index serves the EARS-5 derivation read.
  - `@ds/api` — `POST /v1/events/:idOrSlug/heartbeat` → `RecordPresenceHeartbeat`,
    behind the **same** server-side gate as the EARS-1 `RoomConfig` read (one gate,
    reused): a guest (401), an unregistered doctor (403), and a non-`live` / `ended`
    event (409) are each refused server-side and append **nothing** (EARS-8). On
    admission it appends exactly one row and returns the ack. Classified
    `authenticated` / `doctor_guest` / `policy` in the endpoint-authz matrix.
  - `@ds/portal` — the room mounts a visibility-gated `PresenceHeartbeat` loop (no
    doctor-facing affordance): it POSTs a beat immediately on entry and visible
    resume, then every N seconds — N from `RoomConfig.heartbeatIntervalSeconds`
    (server config, default 60 s) — while the tab is the visible, active tab (Page
    Visibility API); a backgrounded tab (`document.hidden`) emits none.

  Cadence N is server config, parameterized downstream: the per-doctor
  minute derivation + concurrent-tab coalescing is EARS-5 ([#581](https://github.com/doctor-school/ds-platform/issues/581)), room-close
  refusal is EARS-7 ([#583](https://github.com/doctor-school/ds-platform/issues/583)), chat is EARS-3 ([#579](https://github.com/doctor-school/ds-platform/issues/579)). The 006↔007 lifecycle seam
  (live/ended driven by seeded events until 007 lands) is unchanged.

- [#602](https://github.com/doctor-school/ds-platform/pull/602) [`2993933`](https://github.com/doctor-school/ds-platform/commit/29939330ee4c3e904842e699e512fe632d8deb9f) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-1 — CreateEvent authoring vertical (draft, МСК instant, program PDF → object storage)

  Lands the write side of the Webinars event admin (feature 007, EARS-1 + EARS-8):

  - `@ds/schemas` — the shared event-admin contracts: `EventLifecycleState`, the
    closed `LIFECYCLE_TRANSITIONS` map, the `mskLocalToInstant` МСК→instant fold,
    `CreateEventRequest`, and the `EventAdminDetail` / `EventAdminList` read models.
  - `@ds/db` — the `events` + `event_speakers` tables and the
    `event_lifecycle_state` enum (Drizzle) + migration.
  - `@ds/api` — `POST /v1/admin/events` (`CreateEvent`, multipart JSON + program
    PDF), `GET /v1/admin/events` (`EventAdminList`), `GET /v1/admin/events/:id`
    (`EventAdminDetail`), all classified `authenticated` / `platform_admin` /
    `fast-path` (EARS-8); plus a new object-storage module (S3/MinIO adapter +
    in-memory fake) for the program-PDF binary.

- [#618](https://github.com/doctor-school/ds-platform/pull/618) [`c99ba53`](https://github.com/doctor-school/ds-platform/commit/c99ba534eb7b7e3b1816b43baa7b645edec98550) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-3 — ConfigureStream (closed provider enum + embed reference)

  Lands the stream-config handler of the Webinars event admin (feature 007, EARS-3 + EARS-8):

  - `@ds/schemas` — the shared stream-config contracts: the closed
    `STREAM_PROVIDERS` enum (`rutube | youtube`), `ConfigureStreamRequest`, and the
    produced `StreamConfig` read model the 006 room consumes; `EventAdminDetail`
    now carries `streamConfig` (`null` until configured).
  - `@ds/db` — the `stream_config` table (one row per event, `event_id` PK) and the
    `stream_provider` Postgres enum (Drizzle) + migration.
  - `@ds/api` — `PUT /v1/admin/events/:id/stream` (`ConfigureStream`), classified
    `authenticated` / `platform_admin` / `fast-path` (EARS-8). The provider is an
    explicit member of the closed enum (an unknown provider is a 400 with no config
    recorded — never a URL to be sniffed); the write is an idempotent upsert so a
    wrong reference is correctable while `published` with no state reversal;
    configuring outside the `draft`/`published` pre-air window is a 409.

  The admin stream-config **form** (stock Refine) + its browser E2E are the
  integration slice ([#595](https://github.com/doctor-school/ds-platform/issues/595)); this handler ships the backend command + its Vitest
  e2e/unit.
