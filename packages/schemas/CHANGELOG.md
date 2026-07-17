# @ds/schemas

## 1.4.0

### Minor Changes

- [#1055](https://github.com/doctor-school/ds-platform/pull/1055) [`0cbe990`](https://github.com/doctor-school/ds-platform/commit/0cbe9904884bcf6d6b2e4801e3f85726be549cc7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the public month-calendar read side for the webinar listing (004 EARS-15/EARS-16): `GET /v1/public/events?month=YYYY-MM` returns the month's publish-visible events (`published`/`live`/`ended`, the month's already-past events included) as the thin publish-safe `MonthBroadcastEntry` allow-list, and `GET /v1/public/events/month-counts?year=YYYY` returns exactly 12 per-month event counts for the picker. Both endpoints are public (no auth), cacheable, and group by МСК (fixed UTC+3) month boundaries. Adds the `MonthBroadcastEntry` / `MonthlyEventCount` projections plus the `mskMonthRange` / `mskYearRange` SSOT helpers to `@ds/schemas`.

## 1.3.0

### Minor Changes

- [#818](https://github.com/doctor-school/ds-platform/pull/818) [`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat: [#770](https://github.com/doctor-school/ds-platform/issues/770) account profile v1 — `GET /v1/me/profile` (EARS-27: session-scoped self-read of `{email, emailVerified, phone, phoneVerified, displayName}`, nullable-and-present wire shape) + the real `/account` profile surface (EARS-28: canvas «Разделы» render — avatar initials + inline display-name edit, email row with verified badge, read-only phone with explicit empty state, password-reset handoff, «Мои события» link, sign-out; raw session claims removed from the DOM)

## 1.2.0

### Minor Changes

- [#797](https://github.com/doctor-school/ds-platform/pull/797) [`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Display-name SSOT + self-scoped `SetDisplayName` endpoint (006 EARS-14/16, [#705](https://github.com/doctor-school/ds-platform/issues/705)): the `users` mirror gains a nullable `display_name` column (no backfill), the SSOT for a doctor's «Имя и фамилия» collected just-in-time at first webinar-room entry — never at registration. A new `me` module serves two `authenticated` / `doctor_guest` / `fast-path` routes: `PUT /v1/me/display-name` (`SetDisplayName` — writes the trimmed, non-empty-after-trim, ≤100-char name via the `packages/schemas` `SetDisplayNameRequest` SSOT to the caller's OWN row) and `GET /v1/me/display-name` (the caller's own `{ displayName: string | null }`). Self-only by construction — no endpoint takes a target user id, so no caller reaches another doctor's name — and the display name never enters chat payloads (chat identity stays the non-PII author tag). New schema exports: `SetDisplayNameRequestSchema`, `MyDisplayNameSchema`, `DisplayNameSchema`.

## 1.1.0

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

## 1.0.0

### Major Changes

- [#674](https://github.com/doctor-school/ds-platform/pull/674) [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Admin forms now validate on the client with rendered RU error messages ([#665](https://github.com/doctor-school/ds-platform/issues/665), 007
  EARS-10, Stage-B feedback on [#660](https://github.com/doctor-school/ds-platform/issues/660) + rework round 2). ALL admin forms — the login
  form, the create/edit event form, and the stream-config form — derive their rules
  from the `@ds/schemas` / `@ds/design-system` field-schema SSOT (react-hook-form + a
  localized zod→RHF resolver mapping structured issues to the RU catalog), with
  native browser validation suppressed (`noValidate`), surfacing required / bounds /
  format errors inline before the round-trip while the server Zod DTO stays the
  authority.

  **Breaking (`@ds/schemas`):** the stream `embedRef` SSOT is tightened from a
  bounded free token to the provider's REAL id shape (`EMBED_REF_SHAPES`): `youtube`
  = the 11-char video id (`[A-Za-z0-9_-]{11}`), `rutube` = the 32-char lowercase-hex
  video id. A URL-shaped value stays refused with its own message; a garbage token
  (the Stage-B repro `ччсапп`) is now rejected with a provider-specific structured
  issue (`custom` + `params.shape`) — enforced identically at the api DTO boundary
  and in the admin form. Previously-accepted free-token references no longer
  validate, hence the major bump.

### Minor Changes

- [#632](https://github.com/doctor-school/ds-platform/pull/632) [`70f5e3e`](https://github.com/doctor-school/ds-platform/commit/70f5e3e80c90a1738096c2909165a682dd6ee9c7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-6 — draft not-found + non-public visibility policy

  Pins the non-public visibility policy over the two 004 public read endpoints (the
  design §2 visibility table) with a dedicated end-to-end spec
  (`apps/api/test/events/visibility.e2e-spec.ts`): a `draft` event's public page is
  not-found, **byte-for-byte indistinguishable** from a non-existent id (by slug and
  by id — a hidden draft leaks no "exists but private" oracle), and `draft` / `ended`
  / `archived` never appear on the upcoming-broadcasts listing, so the active-broadcasts
  projection only ever carries `published` / `live` cards (the EARS-10 invariant).

  The policy now derives from a single `@ds/schemas` source of truth rather than inline
  literals: a new `isPubliclyReachable(state)` predicate (mirroring `canTransition`) —
  built from the `PUBLIC_EVENT_STATES` allow-list, not a `draft` denylist, so a future
  non-public state is not-found by default — gates the public event page, and the
  listing filter reads the `UPCOMING_BROADCAST_STATES` constant. No public API behaviour
  changes (the mechanism was landed with EARS-1); this handler adds the authoritative
  policy spec and single-sources its two applications.

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

- [#646](https://github.com/doctor-school/ds-platform/pull/646) [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-2 — guest-through-auth completion carrying event context (003 round-trip)

  A guest activating «Участвовать» is now carried through the shipped 003
  login/signup flow with the **event context** and comes out **registered for that
  same event**, landing back on that event page — no re-search, no second
  «Участвовать» tap (feature 005, EARS-2; realizes US-2). This retires the legacy
  "postponed registration" parking mechanism: there is **no** server-side pending
  record — the intent lives only in the round-trip and the real `RegisterForEvent`
  (EARS-1) fires once, after the session exists.

  - `@ds/schemas` (additive) — `RegistrationIntent` / `RegistrationIntentSchema`
    (strict: the intent carries the event slug + a same-origin
    `returnTo=/webinars/:slug` only — **never** PII or a credential; any extra
    field is rejected) and the `parseReturnTarget` / `isSafeReturnTarget`
    open-redirect guard: a cross-origin, protocol-relative, backslash,
    multi-segment, traversal, or percent-encoded-separator return target resolves
    to `null`, and a safe one reconstructs the canonical `/webinars/<slug>` from
    the validated slug.
  - `@ds/portal` — the returnTo survives every hop of the auth round-trip
    (`/register → /verify`, the `/verify → /login` fallback, and the cross links
    between the auth pages) via the guard-cleaning `withReturnTarget`; on auth
    success — password login, OTP login, or the post-verify auto-login replay —
    `completeReturnTarget` fires the same `RegisterForEvent` through the
    same-origin BFF path (`lib/registration-client`) and lands the doctor on the
    event page registered (best-effort: a transient register failure still lands
    on the event page, where the per-user state read / idempotent retry recovers).
    Without a carried context the shipped `/account` landing is unchanged; a
    hostile returnTo is dropped at every hop and never navigated to.

  The live browser E2E for the full guest journey is batched at the 005
  portal-integration slice ([#574](https://github.com/doctor-school/ds-platform/issues/574)).

- [#656](https://github.com/doctor-school/ds-platform/pull/656) [`31b97f2`](https://github.com/doctor-school/ds-platform/commit/31b97f246adfad18d56c336a6559234b1a26c26a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-8 — durable registration record + EventRoster read model

  Adds the `EventRoster` contract to `@ds/schemas` — the set of **current**
  registrations for one event, the durable basis feature 006 (room admission) and
  the wave-2 sponsor report consume (005 EARS-8; realizes US-5).

  - `@ds/schemas` — new `EventRosterEntrySchema` / `EventRosterSchema` (+ types):
    each entry carries **no more than** the `(doctor, event, registeredAt)` fact
    (`{ userId, eventId, registeredAt }`) — no email, name, or any denormalized
    registrant PII. A consumer that needs identity joins to the 003 `users` mirror
    at read time.

  The registration record itself (the `registrations` table + `UNIQUE
(user_id, event_id)`) landed with EARS-1/EARS-3; this handler layers the roster
  read on top: `RegistrationRepository.findEventRoster` +
  `RegistrationService.eventRoster` in `apps/api` read every registration row for
  an event (wave 1 has **no** cancelled state / soft-delete, so the roster is every
  row and every entry is current — owner decision). The roster is an **internal**
  read with **no public endpoint** — never exposed on a 004 public surface, so no
  registrant PII leaks (cross-checked against the public projection). It is owned
  here and consumed cross-feature by 006 + the report — not wired here.

- [#671](https://github.com/doctor-school/ds-platform/pull/671) [`e3ce9eb`](https://github.com/doctor-school/ds-platform/commit/e3ce9eb7780d283d52e32321e1fc145ec1720981) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-1 — server-side room admission gate (RoomAccess grant)

  The webinar room now has its server-side admission gate — the foundation the
  watch side builds on. Room content is served **only** to a caller the backend
  admits, via a server-issued `RoomAccess` grant; there is no soft UI wall over an
  ungated caller (feature 006, EARS-1; carries EARS-8; realizes US-1, US-5).

  - `@ds/api` — new `room` module. `GET /v1/events/:idOrSlug/room` returns the
    `RoomConfig` grant (`{ eventId, heartbeatIntervalSeconds }`) **only** when the
    gate admits: authenticated **AND** registered for the event **AND** the event
    `live`. A guest is refused server-side (401), an unregistered doctor (403), and
    a non-`live` event (409) — a direct URL, a shared link, or a crafted/forged
    request never yields a grant. The `registered` condition **reuses** the 005
    `EventRoster` via `RegistrationService` (006 adds no registration primitive);
    the `live` condition reads the 004/007 `EventLifecycleState` read-only. The
    heartbeat cadence N the grant carries is server config
    (`ROOM_HEARTBEAT_INTERVAL_SECONDS`, default 60 s), never hardcoded.
  - `@ds/api` — the endpoint is the **first `policy` auth_check** in the webinar
    domain (EARS-8): `access: authenticated`, `required_roles: doctor_guest`,
    `auth_check: policy`. The global `AuthzGuard` now supports a **resource-scoped**
    `policy` route (no `objectAttrs`): it enforces the role precondition and lets
    the classified handler evaluate the domain rule (registered ∧ live) and refuse
    server-side. An **object-level** `policy` route (with `objectAttrs`) still fails
    closed until the `IPolicyEngine` lands (DSO-27). Matrix regenerated.
  - `@ds/schemas` — new `RoomConfigSchema` / `RoomConfig` (the `RoomAccess` grant
    DTO SSOT). The provider enum + embed reference (EARS-2), the Centrifugo chat
    token (EARS-3), and the durable presence loop/table (EARS-4) are sibling
    handlers that extend this read model additively.

  The room's `live` window (open/close) and stream config are authored by feature
  007 (a tracked seam, parent [#576](https://github.com/doctor-school/ds-platform/issues/576)); until 007 lands the gate is built +
  E2E-driven against seeded live events with a seeded roster.

- [#684](https://github.com/doctor-school/ds-platform/pull/684) [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-3 — live chat over Centrifugo (gated read + real-time post)

  Where the room is open, a gated doctor reads the live chat and posts messages that
  fan out to every participant in real time without a reload, over the room channel
  keyed by event id (feature 006, EARS-3; realizes US-2). Chat rides Centrifugo,
  already in the stack — 006 adds a `room:event:<id>` channel + a gate-scoped,
  subscribe-only connection token, not a new transport.

  - `@ds/schemas` — the room DTOs grow additively: `RoomConfig.chat`
    (`{ url, token, channel, selfTag } | null`, the subscribe-only Centrifugo
    credential), `PostChatMessageRequest` (`{ text }`, validated by the
    `ChatMessageTextSchema` SSOT — trimmed, non-empty, ≤2000), the published
    `RoomChatMessage` (`{ id, authorTag, text, at }` — PII-free), and
    `PostChatMessageAck`.
  - `@ds/api` — `POST /v1/events/:idOrSlug/chat` (`PostChatMessage`), behind the
    **same** admission gate as EARS-1 (`authenticated ∧ registered ∧ live`): the
    backend authorizes, then publishes to Centrifugo over the HTTP API — the **only**
    publish path. The `RoomConfig` grant carries a connection JWT whose `channels`
    claim is gate-scoped to exactly the caller's room channel and grants **no**
    publish capability, so a client can never publish directly. A guest (401),
    unregistered (403), or non-`live` (409) caller publishes nothing (EARS-8); a
    Centrifugo outage is a 503. Author identity is a non-reversible, non-PII tag
    (`authorTag`), never the roster identity. Classified `authenticated` /
    `doctor_guest` / `policy` in the endpoint-authz matrix. Config (`CENTRIFUGO_*`)
    is read from env; unconfigured ⇒ `chat: null` (fail-closed).
  - `@ds/portal` — the room's chat aside is now live: it subscribes over Centrifugo
    (`centrifuge`, MIT) and renders others' messages in real time without a reload,
    and the composer posts through the gated command. The composer enforces the same
    `ChatMessageTextSchema` reject rule as the server (empty / whitespace-only stays
    unsendable). All copy resolves through the typed message catalog (EARS-10); built
    from `@ds/design-system` tokens (EARS-11).

  Room-close refusal of posts (EARS-7, [#583](https://github.com/doctor-school/ds-platform/issues/583)) and the full both-breakpoints × both-
  themes fidelity + Stage-B live confirmation ([#584](https://github.com/doctor-school/ds-platform/issues/584)) are tracked separately.

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

- [#686](https://github.com/doctor-school/ds-platform/pull/686) [`b46b15a`](https://github.com/doctor-school/ds-platform/commit/b46b15ad2e7b37d0129db0461240979544438c10) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-5 — per-doctor presence-minute derivation (parameterized over N, tab-coalesced)

  The append-only `presence_beats` rows EARS-4 captures now yield **actual per-doctor
  presence minutes** for an event — the durable basis for the wave-1 sponsor report,
  by manual export (feature 006, EARS-5; realizes US-3, US-4). Read-time derivation
  only: no new write, no report UI, no public endpoint.

  - `@ds/schemas` — new `EventPresenceSchema` (`{ eventId, intervalSeconds, doctors:
[{ userId, eventId, minutes }] }`) + `DoctorPresenceMinutesSchema`: the per-event
    presence read model. `minutes` are **derived**, never stored (there is no count
    column); the per-doctor unit is the opaque domain `userId` only — no registrant
    PII (EARS-8).
  - `@ds/api` — `PresenceDerivationService.deriveForEvent(eventId, intervalSeconds?)`
    - `PresenceRepository.deriveEventMinutes` compute minutes as `(distinct N-second
buckets a doctor emitted a beat in) × N / 60` over the append-only beats. Two
      load-bearing properties fall out of the DISTINCT bucket count: **parameterized
      over N** — `intervalSeconds` defaults to `ROOM_HEARTBEAT_INTERVAL_SECONDS`, so an
      operator-confirmed different cadence recomputes the SAME beats with no code
      change; and **concurrent tabs never inflate** — a doctor's parallel-session beats
      land in the same buckets and collapse under DISTINCT (two tabs in one bucket
      count once).
  - `@ds/api` — the wave-1 **manual sponsor export** is a standalone ops CLI
    (`pnpm --filter @ds/api presence:export -- <event-id-or-slug> [intervalSeconds]`),
    an HTTP-less Nest context that prints the `EventPresence` JSON — **not** a public
    endpoint (the derivation is never exposed on a public surface, EARS-8).

  The wave-2 auto report «Отчёт партнёра V2» + auto-NMO consume this same derivation;
  room-close windowing is EARS-7 ([#583](https://github.com/doctor-school/ds-platform/issues/583)) — minutes here are computed over the beats
  that exist (EARS-4 already refuses beats once the room leaves `live`).

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

- [#626](https://github.com/doctor-school/ds-platform/pull/626) [`1b80b39`](https://github.com/doctor-school/ds-platform/commit/1b80b39a7e69c490425d96fd0eedab1bb63d24e7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-2 — edit event + replaceable program PDF (current file served)

  Lands the edit handler of the Webinars event admin (feature 007, EARS-2 + EARS-8):

  - `@ds/schemas` — `UpdateEventRequest`, the **partial** edit contract: every
    field optional with **no default** (an omitted key leaves the stored value;
    `partnerRef: null` explicitly clears it), and the lifecycle `state` is not a
    field of the edit contract — an edit can never smuggle a state reversal.
  - `@ds/api` — `PATCH /v1/admin/events/:id` (`UpdateEvent`), classified
    `authenticated` / `platform_admin` / `fast-path` (EARS-8). Edits an event's
    authored fields at any **pre-archive** state; when a replacement `programPdf`
    rides the same multipart request the stored object reference is **superseded**
    (a fresh, event-scoped key) so the 004 public page serves the **current** file
    and the superseded file is no longer served. The operator never has to
    unpublish to correct a detail — an edit is not a state reversal (the PRD names
    no `published → draft`). An edit to an `archived` event is a 409, an unknown id
    a 404, a malformed field a 400; on any refusal the aggregate is untouched. Like
    create it owes no `audit_ledger` row (that obligation attaches to the lifecycle
    transitions, EARS-4/5/6).

  The admin edit **form** (stock Refine, incl. the PDF re-upload affordance) + its
  browser E2E are the integration slice ([#595](https://github.com/doctor-school/ds-platform/issues/595)); this handler ships the backend
  command + its Vitest e2e/unit.

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

- [#605](https://github.com/doctor-school/ds-platform/pull/605) [`074d2e7`](https://github.com/doctor-school/ds-platform/commit/074d2e78c828fe86687c31038ed61e7285e681d9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-7 — single closed-set lifecycle state machine (server-enforced guard)

  Lands the heart of the Webinars event admin (feature 007, EARS-7 + EARS-8): the
  single `EventLifecycleState` state machine with a server-enforced closed
  transition set, built on the `LIFECYCLE_TRANSITIONS` SSOT shipped by EARS-1.

  - `@ds/schemas` — the closed-set guard predicate `canTransition(from, to)` (the
    single source the read-side `validTransitions` and the server guard both derive
    from) and the `TransitionEventRequest` command body (`{ to }`, constrained to
    the closed lifecycle enum).
  - `@ds/api` — `POST /v1/admin/events/:id/transition` (`platform_admin` /
    fast-path, EARS-8): applies a move only if it is one of the four legal forward
    transitions `draft→published→live→ended→archived`; every invalid jump (a
    skip-forward, any backward move, reopening `archived`, the `published→draft`
    unpublish the PRD names none, or a self-transition) is refused server-side with
    a 409 state conflict and the state is never mutated; a target outside the
    closed enum is a 400. The bare guarded transition every named command
    (EARS-4/5/6) runs through — those layer their product side-effects + audit rows
    on top.

  The named transition commands (publish / open / close / archive) with their
  side-effects + `audit_ledger` rows, and the stock-Refine admin lifecycle actions

  - browser E2E, are sibling handlers (EARS-4/5/6, integration slice [#595](https://github.com/doctor-school/ds-platform/issues/595)).

- [#649](https://github.com/doctor-school/ds-platform/pull/649) [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-6 — «мои события» Предстоящие tab + `MyEvents` read model

  The portal account gains a «мои события» surface (the **Предстоящие** tab of
  `my-events.dc.html`) listing the authenticated doctor's registered **upcoming**
  events, closing the legacy "registered but can't find it" gap (feature 005,
  EARS-6; realizes US-4). Carries the EARS-10 (authz), EARS-11 (МСК), EARS-13
  (canvas fidelity) cross-cutting ACs.

  - `@ds/schemas` — the `MyEventItem` / `MyEvents` DTOs: the caller's registered
    upcoming events, each `{ eventId, slug, title, school, startsAt, state }`,
    `state` constrained to the `published`/`live` registrable set.
  - `@ds/api` — the `MyEvents` read model: `GET /v1/me/events`,
    **`doctor_guest`-authenticated** (EARS-10), returning the caller's registered
    `published`/`live` events (future or currently airing, `starts_at ≥ now −
AIR_WINDOW_MS` — mirroring the 004 upcoming listing), ordered **nearest
    `startsAt` first**. Returns ONLY the caller's own registrations; `ended`/
    `archived` and other doctors' registrations are absent. An empty result is a
    valid `[]`. The endpoint-authz matrix carries the new classified route.
  - `@ds/portal` — the «мои события» page at `/account/events` (SSR, authenticated;
    a guest is redirected to login). Day-grouped, nearest-first, each row the
    reused `@ds/design-system` `WebinarCard` unit (built to the canvas geometry:
    2px borders, `6px 6px 0` shadow, time plate) linking to `/webinars/:slug`, with
    date/time in `Europe/Moscow` labeled **МСК** (EARS-11) and the canvas
    empty-state when the list is empty. Copy resolves through the message catalog
    (EARS-12); DS tokens only (EARS-13). Wave-1 cut: the Записи / Сертификаты tabs
    and the specialty filter are a named deferral — not built.

- [#680](https://github.com/doctor-school/ds-platform/pull/680) [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 006 EARS-2 — room composition + embed player from the explicit provider enum.

  - `@ds/schemas`: `RoomConfigSchema` gains the additive, nullable `stream`
    (`{ provider, embedRef } | null`) reusing the `StreamConfig` SSOT — the
    server-produced embed source the room instantiates the player from. A gated
    caller for a `live` event with no/unknown stream config still receives a grant
    with `stream: null` (the truthful "stream unavailable" room state); the provider
    is read from the closed enum, never URL-sniffed.
  - `@ds/design-system`: new `WebinarRoomLayout` primitive — the neo-brutalist room
    composition shell to the `webinar-room.dc.html` geometry (desktop `1fr 400px`
    player + chat aside; mobile full-bleed player + Чат / О эфире tabs).

- [#606](https://github.com/doctor-school/ds-platform/pull/606) [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-1 — public event-page read endpoint + portal SSR shell

  Adds the read side of the Webinars public surface: `GET /v1/public/events/:idOrSlug`
  (NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
  returning the publish-safe `PublicEventPage` projection (an allow-list — no
  operator/commercial fields, no registrant PII), resolving by slug or id;
  `published`/`live`/`ended`/`archived` → 200, `draft`/unknown → 404. Plus the
  server-rendered portal `/webinars/:slug` route shell (complete HTML for an
  unauthenticated recipient, no client soft-wall) and a shared МСК time formatter.
  Read against seeded fixture events until feature 007 delivers authoring/transitions
  (tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549)). Full content layout, CTA, listing, and lifecycle swap
  are sibling handlers.

- [#613](https://github.com/doctor-school/ds-platform/pull/613) [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-7 — upcoming-broadcasts listing endpoint + day-grouped portal route

  Adds the listing side of the Webinars public surface: `GET /v1/public/events?upcoming`
  (NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
  returning the thin publish-safe `UpcomingBroadcastCard[]` projection (an allow-list —
  name-only speakers, no operator/commercial fields, no registrant PII) filtered to
  `published`/`live` events at or after the air-window cutoff, ordered nearest air date
  first; an empty result is a valid `200 []` (EARS-11). Plus the server-rendered portal
  `/webinars` route — a day-grouped nearest-first list built to the §09 canvas rhythm
  (full-bleed day band on mobile, label + rule on desktop) with the canvas empty-state
  when the projection is empty. Wave-1 minimal cut — no facets, week-paging, month view,
  or search. Cards are the minimal shell (time · МСК · live signal · school · title,
  linking to the event page); the full webinar-card choose-set is sibling EARS-8 ([#557](https://github.com/doctor-school/ds-platform/issues/557)).
  Read against seeded fixture events until feature 007 delivers authoring/transitions
  (tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549)).

## 0.9.0

### Minor Changes

- [#481](https://github.com/doctor-school/ds-platform/pull/481) [`88514b6`](https://github.com/doctor-school/ds-platform/commit/88514b60c93d47805dcc71539e84f89f8b2edda8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add an optional `version` field to `HealthResponseSchema` — the deployed commit
  SHA the api reports at `GET /v1/health` (sourced from the `DEPLOY_SHA` env baked
  into the container by `pnpm deploy:prod`, DSO-127). Additive and optional: unset
  in local dev / tests where no deploy stamped a SHA.

## 0.8.0

### Minor Changes

- [#321](https://github.com/doctor-school/ds-platform/pull/321) [`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Resend registration verification code ([#319](https://github.com/doctor-school/ds-platform/issues/319), EARS-25): `POST /v1/auth/verify/resend`.

  - **New endpoint** — `POST /v1/auth/verify/resend` takes `{ identifier }` (the email) and re-issues the Zitadel `otp_email` registration verification code **enumeration-safely**: a code is re-issued only for an existing, **unverified** registrant; an unknown identifier or an already-verified one is a silent no-op with an identical ack (`resend_requested`), status, and timing (EARS-16). It is `@Public @RateLimited @TimingEqualized @BotProtected("verify-resend")` like the other abuse-prone unauthenticated surfaces, and appends an `otp.sent` ledger row (EARS-18) only when a code is actually issued — so the ledger is not itself an existence oracle. Lets a registrant whose first code did not arrive re-request it from the existence-agnostic `/verify` screen (EARS-24) without re-typing the password.
  - **New `@ds/schemas` exports** — `VerifyResendRequestSchema` / `VerifyResendRequest` and `VerifyResendResponseSchema` / `VerifyResendResponse` (loose `{ identifier }` contract, like `PasswordResetRequestSchema`).
  - **New IdP port method** — `IdpClient.resendEmailVerification(identifier)` resolves the identifier → Zitadel `sub` internally (mirroring `requestPasswordReset` / `requestEmailOtp`) and re-issues the code only for an existing, unverified registrant, returning a server-side boolean that drives the ledger decision (never reflected into the response). The pre-existing `requestEmailVerification(sub)` is not reused directly because it takes a resolved `sub`, whereas this endpoint receives a raw identifier and the port carries no other targeted lookup.

## 0.7.0

### Minor Changes

- [#201](https://github.com/doctor-school/ds-platform/pull/201) [`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Localize the creation-password complexity error to RU and validate auth forms on blur ([#200](https://github.com/doctor-school/ds-platform/issues/200), 003).

  `@ds/schemas` now exports `NEW_PASSWORD_COMPLEXITY`, the bare creation-password
  complexity regex, as the single SSOT for the pattern. `NewPasswordSchema` is
  rebuilt from it and keeps its deliberately-generic English DTO message unchanged
  (no API behavior change). The portal's `NewPasswordFieldSchema` composes the regex
  **without** a message so the localized resolver maps the resulting `invalid_format`
  issue to the RU `errors.validation.passwordComplexity` copy — in zod v4 a
  schema-level message would otherwise outrank the contextual error map and leak
  English on `/register` and `/reset`.

  `/register` and `/reset` (complete step) now resolve from portal-composed,
  channel-specific schemas built from the field primitives (mirroring the existing
  OTP-login pattern) instead of the request schemas; the submitted body and the API
  contract are unchanged. All auth forms run in `mode: "onTouched"` so a malformed
  email/phone/password is flagged on blur, before submit.

- [#199](https://github.com/doctor-school/ds-platform/pull/199) [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): [#197](https://github.com/doctor-school/ds-platform/issues/197) enforce field validation/mask by construction — semantic field primitives + ESLint gate (003)

  Portal auth forms were assembled from raw design-system `<Input>` + a per-form
  loose resolver, so validation/mask was hand-wired field-by-field and easy to
  forget — the root cause of the live defects [#192](https://github.com/doctor-school/ds-platform/issues/192) (`/login` identifier) and [#196](https://github.com/doctor-school/ds-platform/issues/196)
  (`/reset` identifier). This lands the enforced-by-construction layer of EARS-22
  (003 design §8.2):

  - **Five semantic field primitives** (`apps/portal/components/fields`):
    `EmailField`, `PhoneField`, `OtpField`, `PasswordField`, and `IdentifierField`
    (the email-or-phone union box). Each bakes in validation + (where relevant) the
    E.164 phone mask + a11y + RU copy and co-locates its zod resolver fragment, so
    no per-call wiring. The loose `@ds/schemas` request contracts are unchanged.
  - **A custom ESLint gate** (`local/no-raw-auth-field-input`) that makes a raw
    credential `<Input>` — or a hand-rolled native `<input>` — impossible to render
    on the auth surfaces; the field must come from the primitives. Rides the
    existing `lint` CI job.
  - **All auth surfaces migrated** with behavior preserved ([#192](https://github.com/doctor-school/ds-platform/issues/192)/[#175](https://github.com/doctor-school/ds-platform/issues/175) intact), and
    **/reset identifier now validated + masked-aware** — the [#196](https://github.com/doctor-school/ds-platform/issues/196) fix.
  - **`@ds/schemas`** now exports the creation-password fragment as
    `NewPasswordSchema` (was a private `NewPassword`), so the portal composes the
    complexity baseline from the SSOT instead of re-declaring the regex — additive,
    the request schemas are unchanged.

## 0.6.0

### Minor Changes

- [#152](https://github.com/doctor-school/ds-platform/pull/152) [`2f56c78`](https://github.com/doctor-school/ds-platform/commit/2f56c7853f670808fb50033f7821201bb2197162) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(schemas): [#147](https://github.com/doctor-school/ds-platform/issues/147) raise creation password contract to mirror Zitadel policy

  The `@ds/schemas` creation-password contract was weaker than the live Zitadel
  default complexity policy (`min8 + upper/lower/digit/symbol`), so a registrant
  could pass schema validation with a password Zitadel rejects (400 inside
  `createUser`) — a divergence that was neither aligned nor enumeration-checked.

  `@ds/schemas`: a new `NewPassword` (creation) schema adds the four-class
  complexity requirement and applies it to `RegisterRequest.password` and
  `PasswordResetCompleteRequest.newPassword`, mirroring the Zitadel default as a
  **baseline, not a ceiling** (Zitadel remains the credential authority and may be
  configured stricter). `LoginPassword` (login) stays permissive — no complexity —
  so legacy credentials that predate the policy can still authenticate. This is a
  consumer-visible contract tightening (a password that previously validated may
  now be rejected), hence a pre-1.0 minor bump.

  `@ds/api`: closes the enumeration-safe residual race where a live Zitadel
  configured stricter than baseline 400s inside `createUser`. The adapter raises a
  typed `IdpPasswordPolicyError` only on a password/complexity 400 (any other 4xx
  stays opaque → 500, fail-closed), and `AuthService.register` maps it to a generic
  **422** identical regardless of account existence — never a 500, never an oracle.
  The existing 409→`alreadyExisted` enumeration hinge is untouched.

- [#129](https://github.com/doctor-school/ds-platform/pull/129) [`6109639`](https://github.com/doctor-school/ds-platform/commit/610963971ea88b65796b80b59a571e92def6d9ca) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#87](https://github.com/doctor-school/ds-platform/issues/87) passwordless login — email-OTP + SMS-OTP + SMS budget (003 F3)

  Implements EARS-6 (email-OTP login via Zitadel `otp_email`), EARS-7 (SMS-OTP
  login via `otp_sms`), and EARS-14 (SMS toll-fraud budget circuit-breaker), per
  003-design §2/§6/§10 and ADR-0001 §4/§7. Both OTP variants converge on the F2
  session-establishment step (`SessionService.establish`), so the `__Host-`
  cookie / token logic exists exactly once across every login variant.

  `@ds/api`: extends the `IdpClient` port with `requestEmailOtp` /
  `loginWithEmailOtp` / `requestSmsOtp` / `loginWithSmsOtp` (the verify methods
  return a checked `IdpSession`, the same shape `passwordLogin` yields; fake is
  fully exercised, the Zitadel adapter carries them as documented design-§11
  integration seams alongside the existing token-exchange seam). Adds a
  `SmsBudgetService` — four fixed-window counters (per-phone 3/h, per-IP 10/h,
  per-ASN 100/h, global daily ≤2000) that gate before the provider send and refuse
  fail-closed with a generic throttled response, consuming nothing on refusal. New
  public routes `POST /v1/auth/login/otp/request` and `POST /v1/auth/login/otp`
  (channel discriminator; SMS request budget-gated, ASN from the edge `x-asn`
  header). Enumeration-safe throughout (EARS-16): unknown identifier and
  wrong/expired code are indistinguishable; budget refusals leak no threshold.

  `@ds/schemas`: adds the `OtpChannel`, `OtpRequest` / `OtpRequestResponse`
  (`otp_sent`) and `OtpVerify` contracts (verify reuses the `authenticated`
  `LoginResponse`).

## 0.5.0

### Minor Changes

- [#127](https://github.com/doctor-school/ds-platform/pull/127) [`cad6ad3`](https://github.com/doctor-school/ds-platform/commit/cad6ad3c7d1297ecc5a2e05a37d4b2d4b161b9ab) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#89](https://github.com/doctor-school/ds-platform/issues/89) password reset (003 F5)

  Implements EARS-11 (enumeration-resistant reset initiate → Zitadel
  forgot-password code flow; identical response whether or not the identifier
  exists) and EARS-12 (complete → IdP sets the new password against the reset
  code, every existing session of the subject is revoked, `PasswordResetCompleted`
  emitted), per 003-design §6/§10 and ADR-0001 §6/§7.

  `@ds/api`: `IdpClient.requestPasswordReset` / `completePasswordReset` (fake +
  Zitadel User v2 adapter, both enumeration-safe / fail-closed), a new
  `SessionStore.deleteBySub` global-revocation primitive backed by a `sub → sids`
  index (in-memory + Redis), `SessionService.revokeAllForSub`, and the public
  `POST /v1/auth/password/reset` (`@BotProtected`) + `POST
/v1/auth/password/reset/complete` routes.

  `@ds/schemas`: adds the `PasswordResetRequest`/`PasswordResetResponse`
  (`reset_requested`) and `PasswordResetCompleteRequest`/`PasswordResetCompleteResponse`
  (`reset_completed`) contracts.

- [#125](https://github.com/doctor-school/ds-platform/pull/125) [`03d5d2e`](https://github.com/doctor-school/ds-platform/commit/03d5d2e79ffc84f13b88eac2e34c043e0b3ee294) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#88](https://github.com/doctor-school/ds-platform/issues/88) session refresh rotation + logout (003 F4)

  Implements EARS-9 (single-use refresh rotation; RFC-6819 reuse → chain
  invalidation + session revoke + `RefreshReuseDetected`) and EARS-10 (logout →
  server-side session DELETE + `__Host-` cookie cleared + `SessionRevoked`), per
  003-design §3 and ADR-0001 §6/§7.

  `@ds/api`: `IdpClient.refreshTokens` (IdP-owned reuse detection), `SessionStore`
  `rotate` + `delete`, `SessionService.refresh` / `.logout`, an `AuthAuditLog`
  seam (`AUTH_AUDIT`, in-memory until the F6 durable writer), and the
  `doctor_guest`-protected `POST /v1/auth/refresh` + `POST /v1/auth/logout` routes.

  `@ds/schemas`: adds the token-free `RefreshResponse` (`refreshed`) and
  `LogoutResponse` (`logged_out`) contracts.

## 0.4.0

### Minor Changes

- [#123](https://github.com/doctor-school/ds-platform/pull/123) [`2db1879`](https://github.com/doctor-school/ds-platform/commit/2db18796e2db751abe31c1f5287c9400fb9e3f84) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#86](https://github.com/doctor-school/ds-platform/issues/86) password login + BFF session establishment + token exchange (003 F2)

  Implements EARS-5 (password login) and EARS-8 (BFF session over a `__Host-`
  cookie) — the single session-establishment step every login variant converges on
  (design §3/§6).

  `@ds/schemas`: adds the `LoginRequest` / `LoginResponse` contracts (single
  `identifier` box, token-free response) and `SessionClaims` (the principal subset
  `sub, roles[], mfa` the BFF surfaces).

  `@ds/api`:
  - Extends the `IdpClient` port with `passwordLogin` (Zitadel Session v2 check;
    unknown-identifier and wrong-password are indistinguishable, EARS-16; the
    native lockout counter increments on the IdP side, EARS-15) and
    `exchangeSessionForTokens` (OIDC exchange → access JWT + opaque rotating
    refresh + principal claims). The in-memory fake implements both; the real
    Zitadel adapter implements the session check and fails closed on the
    OIDC exchange until the per-recipe OIDC app config is plumbed (design §11).
  - Adds a `SessionStore` port (server-side `ActiveSession`, design §3) with an
    in-memory fake (default / CI binding) and a Redis adapter bound only when
    `REDIS_URL` is set (the production binding, ADR-0001 §6) — mirroring the IdP
    fake/real split so the suite runs without a live Redis.
  - `SessionService` establishes the session: OIDC exchange → fresh `sid` →
    server-side record (tokens never leave the BFF) → `__Host-` HttpOnly+Secure+
    SameSite=Lax cookie with a fingerprint (`hash(UA + IP/24 + accept-language)`).
  - `POST /v1/auth/login` (public) sets the cookie and returns a token-free body;
    failures are a single generic 401 (EARS-16). `GET /v1/auth/session`
    (`doctor_guest`-protected, design §7.2) returns the principal claims.
  - A Fastify `onRequest` hook populates the request subject the global `AuthzGuard`
    reads — the authentication seam left open in `authz.guard.ts` — rejecting a
    cookie whose re-derived fingerprint diverges from the bound one.

  The login captcha-after-N-failures policy (EARS-17 login surface) and refresh
  rotation / logout (EARS-9/10) are owned by F6 ([#90](https://github.com/doctor-school/ds-platform/issues/90)) and F4 ([#88](https://github.com/doctor-school/ds-platform/issues/88)). Closes [#86](https://github.com/doctor-school/ds-platform/issues/86).

## 0.3.0

### Minor Changes

- [#120](https://github.com/doctor-school/ds-platform/pull/120) [`6e7bd0c`](https://github.com/doctor-school/ds-platform/commit/6e7bd0c30e98f04fe0ccd9f3c93b4f3067006a2e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#85](https://github.com/doctor-school/ds-platform/issues/85) registration + verification + consent + mirror sync (003 F1, EARS-1,2,3,4,19,20)

  The first functional slice of the 003 auth vertical. `@ds/api` gains an `auth`
  module (the BFF over Zitadel, design §1/§2): self-service registration with
  email+password or phone+password (EARS-1/2), a consent gate that records the
  accepted per-purpose versions atomically with the `doctor_guest` mirror row and
  refuses any PD-bearing row without consent (EARS-20), email/SMS OTP verification
  that flips the mirror `*_verified` flag (EARS-3/4), and a Zitadel Action webhook
  plus reconciliation sweep that upsert the mirror and ensure the role grant
  (EARS-19). Register/verify responses are enumeration-resistant — an existing
  identifier yields the identical response with no duplicate account (EARS-16) —
  and registration is `@BotProtected` (EARS-17 mechanism from [#84](https://github.com/doctor-school/ds-platform/issues/84)).

  Every credential operation is delegated to Zitadel through a new `IdpClient`
  port (design §2 native-vs-custom boundary): `apps/api` hashes no password,
  generates no code, and verifies none itself. The port is bound to the real
  `ZitadelIdpClient` (User v2 API) when a service token is configured and to an
  in-memory fake otherwise, so the cascade runs end-to-end against a real Postgres
  without a live IdP. `@ds/schemas` gains the F1 request/response contracts.
  Audit-ledger emission (EARS-18) and the periodic reconcile schedule remain
  documented seams for F6. Closes [#85](https://github.com/doctor-school/ds-platform/issues/85).

## 0.2.0

### Minor Changes

- [#62](https://github.com/doctor-school/ds-platform/pull/62) [`275d575`](https://github.com/doctor-school/ds-platform/commit/275d575a0a5878c8a077146971b6e4cc7ce88d11) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): GET /v1/ready with Postgres + pgvector probes

  Adds a readiness endpoint that probes Postgres (`SELECT 1`) and the pgvector
  extension (`to_regtype('vector')`) via `Promise.allSettled`, returning a
  Zod-validated body (HTTP 200 when both pass, HTTP 503 — same shape — when any
  probe fails). `@ds/schemas` gains `ReadinessResponseSchema` + `CheckStatusSchema`
  (reusable building block for future Redis/MinIO/Centrifugo probes). Closes [#60](https://github.com/doctor-school/ds-platform/issues/60).

## 0.1.0

### Minor Changes

- [#9](https://github.com/doctor-school/ds-platform/pull/9) [`1fa06ec`](https://github.com/doctor-school/ds-platform/commit/1fa06eccfbb41aae1b0de016f2012874b07a3f9e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Bootstrap `apps/api` (NestJS 11 + Fastify + nestjs-zod, ESM, Node 22) with the first endpoint `GET /v1/health` returning `{ status: 'ok', uptime, timestamp }` via `VersioningType.URI`. Bootstrap `packages/schemas` from stub to host `HealthResponseSchema` — the first Zod entry in the API SSOT (ADR-0002 §3, ADR-0006 §6.2).
