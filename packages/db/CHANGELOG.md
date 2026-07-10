# @ds/db

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
  authenticated heartbeat every N seconds and the backend appends each accepted
  beat to a durable append-only Postgres table — the durable basis for the
  per-doctor sponsor minutes (feature 006, EARS-4; realizes US-3).

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
    doctor-facing affordance): it POSTs a beat every N seconds — N from
    `RoomConfig.heartbeatIntervalSeconds` (server config, default 60 s) — while the
    tab is the visible, active tab (Page Visibility API); a backgrounded tab
    (`document.hidden`) emits none, and the loop resumes on re-visibility.

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
