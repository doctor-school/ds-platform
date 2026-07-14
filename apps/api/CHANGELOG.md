# @ds/api

## 0.18.3

### Patch Changes

- [#894](https://github.com/doctor-school/ds-platform/pull/894) [`0247f98`](https://github.com/doctor-school/ds-platform/commit/0247f98e5d2aeda24e4d8a724007d3d36be06015) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Password-reset email is code-only ([#880](https://github.com/doctor-school/ds-platform/issues/880)): the EARS-11 reset send now carries the `sendLink` oneof with a bare portal `/reset` urlTemplate, so the email's button never lands on Zitadel's hosted set-password page and no URL in the mail consumes anything on GET; the `passwordreset` message text is branded (ru+en) at provisioning with the [#869](https://github.com/doctor-school/ds-platform/issues/869) code-only contract (code as one unbroken enlarged token, subject leading with the code, explicit 1-hour expiry, ignore-if-not-requested line).

## 0.18.2

### Patch Changes

- [#891](https://github.com/doctor-school/ds-platform/pull/891) [`1dd740a`](https://github.com/doctor-school/ds-platform/commit/1dd740a9d399262c2fb31100000fcc6a6cb59376) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Identity emails no longer greet users with the internal «<local-part> guest» placeholder ([#878](https://github.com/doctor-school/ds-platform/issues/878)): user creation now sends an explicit Zitadel `displayName` = the registration email, and every user-facing IdP email greets with a neutral «Здравствуйте!» — the email-OTP login mail is fully branded code-only (subject leads with the code), and the dormant verify-phone / password-change / init templates get the same neutral greeting. Password-reset rework is tracked separately ([#880](https://github.com/doctor-school/ds-platform/issues/880)).

- [#879](https://github.com/doctor-school/ds-platform/pull/879) [`e9f835e`](https://github.com/doctor-school/ds-platform/commit/e9f835eecb3343acc7c9a67f40e98a3931de9b0b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: the registration verification email is code-only ([#869](https://github.com/doctor-school/ds-platform/issues/869)). Both email-verification sends (initial EARS-3 + EARS-25 resend) deliver a branded Russian mail whose subject leads with the code and whose body shows it as one unbroken, enlarged token with an explicit 1-hour expiry — no code-consuming link (mail-scanner AV prefetch GETs every URL in a delivered message, burning GET-consumed deep-links). Zitadel's default CTA into its hosted login-v2 UI is replaced by a bare portal `/verify` navigation URL (`SendEmailVerificationCode.urlTemplate`, no query/params — nothing consumed on GET); the user types the code on the portal `/verify` screen where the existing auto-login replay signs them in. The `/v1/auth/verify` contract, SMS hops, and enumeration-safety (EARS-16/24/25) are unchanged.

## 0.18.1

### Patch Changes

- [#852](https://github.com/doctor-school/ds-platform/pull/852) [`6f535b0`](https://github.com/doctor-school/ds-platform/commit/6f535b0bd1f9c9bbfaedca8c29f33f4bfc46b79b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: program-PDF download from the public event page ([#842](https://github.com/doctor-school/ds-platform/issues/842)) — `ObjectStorage.urlFor` now issues a short-lived SigV4 presigned GET (15 min TTL) instead of a plain unsigned object URL, which the private prod bucket denied with `AccessDenied`. The in-memory fake mirrors the signed-GET contract (unsigned URL shape → 403), so dev/test verification can no longer pass a URL shape prod refuses.

## 0.18.0

### Minor Changes

- [#818](https://github.com/doctor-school/ds-platform/pull/818) [`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat: [#770](https://github.com/doctor-school/ds-platform/issues/770) account profile v1 — `GET /v1/me/profile` (EARS-27: session-scoped self-read of `{email, emailVerified, phone, phoneVerified, displayName}`, nullable-and-present wire shape) + the real `/account` profile surface (EARS-28: canvas «Разделы» render — avatar initials + inline display-name edit, email row with verified badge, read-only phone with explicit empty state, password-reset handoff, «Мои события» link, sign-out; raw session claims removed from the DOM)

### Patch Changes

- Updated dependencies [[`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344)]:
  - @ds/schemas@1.3.0

## 0.17.0

### Minor Changes

- [#797](https://github.com/doctor-school/ds-platform/pull/797) [`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Display-name SSOT + self-scoped `SetDisplayName` endpoint (006 EARS-14/16, [#705](https://github.com/doctor-school/ds-platform/issues/705)): the `users` mirror gains a nullable `display_name` column (no backfill), the SSOT for a doctor's «Имя и фамилия» collected just-in-time at first webinar-room entry — never at registration. A new `me` module serves two `authenticated` / `doctor_guest` / `fast-path` routes: `PUT /v1/me/display-name` (`SetDisplayName` — writes the trimmed, non-empty-after-trim, ≤100-char name via the `packages/schemas` `SetDisplayNameRequest` SSOT to the caller's OWN row) and `GET /v1/me/display-name` (the caller's own `{ displayName: string | null }`). Self-only by construction — no endpoint takes a target user id, so no caller reaches another doctor's name — and the display name never enters chat payloads (chat identity stays the non-PII author tag). New schema exports: `SetDisplayNameRequestSchema`, `MyDisplayNameSchema`, `DisplayNameSchema`.

### Patch Changes

- Updated dependencies [[`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb)]:
  - @ds/schemas@1.2.0
  - @ds/db@0.5.0

## 0.16.0

### Minor Changes

- [#775](https://github.com/doctor-school/ds-platform/pull/775) [`54c0175`](https://github.com/doctor-school/ds-platform/commit/54c01754735186fd86c6bbbbf2649c343d84c8eb) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Reconcile depth (EARS-19, [#753](https://github.com/doctor-school/ds-platform/issues/753)): the mirror-sync sweep now closes the full reconciliation depth deferred by 003. It resolves mirror-vs-Zitadel divergence **Zitadel-wins** on the identity fields (`email`/`phone`/`email_verified`/`phone_verified`) while preserving the mirror-owned `role`/`id`/`created_at`, and emits an `auth.reconcile.divergence` audit event naming only the changed field names (never the values). Users removed or deactivated in Zitadel have their mirror row **soft-deleted** (new nullable `users.deactivated_at`; rows are never hard-deleted so the audit trail survives) and are not re-granted `doctor_guest`; a user that reappears active is reactivated. `deactivated_at` is a projection flag, not an authz gate. The real `listUsers()` adapter now paginates in full and throws on failure so a partial/failed enumeration can never wipe the mirror.

### Patch Changes

- Updated dependencies [[`54c0175`](https://github.com/doctor-school/ds-platform/commit/54c01754735186fd86c6bbbbf2649c343d84c8eb)]:
  - @ds/db@0.4.0

## 0.15.1

### Patch Changes

- [#723](https://github.com/doctor-school/ds-platform/pull/723) [`589f68f`](https://github.com/doctor-school/ds-platform/commit/589f68f6cac69db3dfa2b7a93e9493edc2578efc) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 007 EARS-2 ([#627](https://github.com/doctor-school/ds-platform/issues/627)): garbage-collect superseded program-PDF objects on reference swap. A successful PDF replacement now deletes the superseded object key from object storage after the swap is durably committed (best-effort — a storage failure warn-logs the orphan key and never fails the edit). The `ObjectStorage` port gains `delete(key)` (S3 adapter + in-memory fake).

- [#724](https://github.com/doctor-school/ds-platform/pull/724) [`cbda29f`](https://github.com/doctor-school/ds-platform/commit/cbda29f6a06bf0dcf25fd2ac30864a252b5f2a33) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix [#709](https://github.com/doctor-school/ds-platform/issues/709): an IdP-authenticated session whose `zitadel_sub` had no `users` mirror row (webhook miss/lag, or a mirror row lost while the IdP session stayed alive) bounced every mirror-backed authenticated surface into a silent `/login` → `/account` redirect carousel via the generic 401. The session auth hook now lazily self-heals the mirror on an authenticated read (EARS-26): a targeted `IdpClient.getUser(sub)` fetch + the same idempotent `UserMirrorService.upsert` and `doctor_guest` re-grant the Zitadel webhook and reconciliation sweep perform, before the handler runs. EARS-16 generic-401 semantics for genuinely unauthenticated callers are unchanged.

## 0.15.0

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

### Patch Changes

- Updated dependencies [[`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605)]:
  - @ds/schemas@1.1.0
  - @ds/db@0.3.0

## 0.14.0

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

- [#611](https://github.com/doctor-school/ds-platform/pull/611) [`bdbfbc9`](https://github.com/doctor-school/ds-platform/commit/bdbfbc983a8e5e7ab59ed12b075be07cad2ffe7e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-4 — publish transition (draft → published)

  Lands the first **named** lifecycle command of the Webinars event admin (feature
  007, EARS-4 + EARS-8): `PublishEvent`.

  - `@ds/api` — `POST /v1/admin/events/:id/publish` (`platform_admin` / fast-path,
    EARS-8). It runs through the EARS-7 closed-set guard — publish is **refused
    with a 409 unless the event is in `draft`** (any non-draft origin leaves the
    state untouched) — and, on success, applies the `draft → published` move **and
    appends exactly one** terminal `audit_ledger` row **atomically** in a single
    transaction (`event_type = event.published`, keyed to the acting admin; the
    aggregate id + `from`/`to` in `metadata`, no PD — ADR-0003 §6). Publishing is
    the single visibility signal: the same `EventLifecycleState` write makes the
    event publicly reachable on the 004 event page + upcoming listing and opens 005
    registration gating — one state, no second boolean flag (EARS-9). There is no
    idempotent re-publish (a second publish from `published` is the guard's 409).

  The admin publish **action** (stock Refine, offered only from `draft` via
  `EventAdminDetail.validTransitions`) and the browser E2E journey are the tracked
  integration slice ([#595](https://github.com/doctor-school/ds-platform/issues/595), blocked by EARS-1…7); this handler ships the backend
  command + its Vitest e2e. The remaining named transitions (open / close /
  archive) are sibling handlers (EARS-5/6).

- [#620](https://github.com/doctor-school/ds-platform/pull/620) [`cabf346`](https://github.com/doctor-school/ds-platform/commit/cabf34668acf91bf7a7fcf0d354cfa425f0e208e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-5 — open/close room (published → live → ended)

  Lands the director's two air-day lifecycle commands of the Webinars event admin
  (feature 007, EARS-5 + EARS-8): `OpenRoom` and `CloseRoom`.

  - `@ds/api` — `POST /v1/admin/events/:id/open` (`OpenRoom`, `published → live`)
    and `POST /v1/admin/events/:id/close` (`CloseRoom`, `live → ended`), both
    `platform_admin` / fast-path (EARS-8). Each runs through the EARS-7 closed-set
    guard on the shared `namedTransition` path — open is **refused with a 409
    unless the event is in `published`**, close **unless it is in `live`** (any
    other origin leaves the state untouched and writes no audit row) — and, on
    success, applies the move **and appends exactly one** terminal `audit_ledger`
    row **atomically** (`event_type = event.went_live` / `event.ended`, keyed to
    the acting admin; the aggregate id + `from`/`to` in `metadata`, no PD —
    ADR-0003 §6). Opening the room starts 006 admission of registered doctors +
    presence capture; closing it stops admission + heartbeat/chat acceptance and
    **bounds the presence window** (006 EARS-7). The `live` window is exactly these
    two transitions — the single `EventLifecycleState` 006 gates on, no second flag
    (EARS-9). 006's own admission/heartbeat/chat refusal logic consumes this state
    and is out of scope, as are publish (EARS-4) and archive (EARS-6).

  The admin open/close **actions** (stock Refine, each offered only from its valid
  state via `EventAdminDetail.validTransitions`) and the browser E2E journey are
  the tracked integration slice ([#595](https://github.com/doctor-school/ds-platform/issues/595)); this handler ships the backend commands +
  their Vitest e2e. `publish()` was refactored onto the same shared
  `namedTransition` helper (no behavior change).

- [#625](https://github.com/doctor-school/ds-platform/pull/625) [`9c3c882`](https://github.com/doctor-school/ds-platform/commit/9c3c8827cb1668e871ff4788bb8fd70484b7928e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 007 EARS-6 — manual archive transition (ended → archived)

  Lands the operator's manual post-broadcast archive command of the Webinars event
  admin (feature 007, EARS-6 + EARS-8): `ArchiveEvent`.

  - `@ds/api` — `POST /v1/admin/events/:id/archive` (`ArchiveEvent`,
    `ended → archived`), `platform_admin` / fast-path (EARS-8). It runs through the
    EARS-7 closed-set guard on the shared `namedTransition` path — archive is
    **refused with a 409 unless the event is in `ended`** (any other origin leaves
    the state untouched and writes no audit row) — and, on success, applies the
    move **and appends exactly one** terminal `audit_ledger` row **atomically**
    (`event_type = event.archived`, keyed to the acting admin; the aggregate id +
    `from`/`to` in `metadata`, no PD — ADR-0003 §6). After archive the event
    **leaves all public surfaces** off the single `EventLifecycleState` (EARS-9):
    004's upcoming listing drops it by state and its public event page degrades to
    the archived-notice body (a **200**, never a dead 404 — the notice rendering is
    the consumer slice 004 EARS-5). `archived` is **terminal** — no reopen (EARS-7).

  Archive is manual by design — **LD-2**: wave 1 carries **no scheduler and no
  time-based automation** that could fire the transition (a source-scan test
  asserts no timer primitive exists in the events module); a time-based
  auto-archive policy is a named wave-2 candidate. The admin archive **action**
  (stock Refine, offered only from `ended` via `EventAdminDetail.validTransitions`)
  and the browser E2E journey are the tracked integration slice ([#595](https://github.com/doctor-school/ds-platform/issues/595)); this
  handler ships the backend command + its Vitest e2e.

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

### Patch Changes

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

- [#687](https://github.com/doctor-school/ds-platform/pull/687) [`d57ac0c`](https://github.com/doctor-school/ds-platform/commit/d57ac0c7b609f1ace068c67af2181c54ee1181e2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-7 — room-close stops heartbeat + chat capture

  When the event leaves `live` (the director closes the room, feature 007), the
  system stops accepting heartbeats and chat posts for that event and the room
  degrades to the truthful ended state (feature 006, EARS-7; realizes US-3, US-4).
  This handler adds no new code path — the refusal is the SAME server-side admission
  gate as EARS-1 (`authenticated ∧ registered ∧ live`): once the event leaves `live`
  the `live` condition fails and every room operation is refused server-side. EARS-7
  pins that close semantics as one coherent, verified story.

  - `@ds/api` — the `RoomConfig` grant read, the gated heartbeat, and the gated chat
    post are each refused with a `409` carrying the truthful `ended` state once the
    room closes. A beat/post accepted while the room was open is refused the instant
    it closes, and NO beat or post lands after close (`presence_beats` does not grow).
    Per-doctor presence minutes (EARS-5) are therefore computed over the beats
    captured **while the room was open** — a beat refused after close never exists,
    so it cannot inflate the sponsor minutes. Pinned by the Vitest e2e
    (`apps/api/test/room/room-close.e2e-spec.ts`).
  - `@ds/portal` — the room surface degrades TRUTHFULLY: after close the gate no
    longer issues the grant, so the `not-live` branch routes the doctor to the 004
    ended lifecycle state («Эфир завершён») with no watchable player, no writable
    chat, and no room composition — never a soft wall over a dead room. Verified
    end-to-end on the live stand (`apps/portal/e2e/room-close.spec.ts`).

  The 006↔007 lifecycle seam is unchanged (the live → ended transition is driven by
  seeded events until 007's director controls land, tracked on parent [#576](https://github.com/doctor-school/ds-platform/issues/576));
  Stage-B canvas fidelity is batched at [#584](https://github.com/doctor-school/ds-platform/issues/584).

- Updated dependencies [[`70f5e3e`](https://github.com/doctor-school/ds-platform/commit/70f5e3e80c90a1738096c2909165a682dd6ee9c7), [`ce4b05d`](https://github.com/doctor-school/ds-platform/commit/ce4b05dd06d5d0c2ed39e04b87f7cca2d396185b), [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c), [`68c6f83`](https://github.com/doctor-school/ds-platform/commit/68c6f838648df6b5ecc0bf24d94cb1737cfba8a1), [`31b97f2`](https://github.com/doctor-school/ds-platform/commit/31b97f246adfad18d56c336a6559234b1a26c26a), [`e3ce9eb`](https://github.com/doctor-school/ds-platform/commit/e3ce9eb7780d283d52e32321e1fc145ec1720981), [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3), [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c), [`b46b15a`](https://github.com/doctor-school/ds-platform/commit/b46b15ad2e7b37d0129db0461240979544438c10), [`2993933`](https://github.com/doctor-school/ds-platform/commit/29939330ee4c3e904842e699e512fe632d8deb9f), [`1b80b39`](https://github.com/doctor-school/ds-platform/commit/1b80b39a7e69c490425d96fd0eedab1bb63d24e7), [`c99ba53`](https://github.com/doctor-school/ds-platform/commit/c99ba534eb7b7e3b1816b43baa7b645edec98550), [`074d2e7`](https://github.com/doctor-school/ds-platform/commit/074d2e78c828fe86687c31038ed61e7285e681d9), [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66), [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2), [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75), [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873), [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211)]:
  - @ds/schemas@1.0.0
  - @ds/db@0.2.0

## 0.13.0

### Minor Changes

- [#482](https://github.com/doctor-school/ds-platform/pull/482) [`b3c3587`](https://github.com/doctor-school/ds-platform/commit/b3c35873923a50a295421c34846032bb11696a31) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add GlitchTip (self-hosted Sentry-compatible) error monitoring to the api. `@sentry/node` is initialised only when `SENTRY_DSN` is set (prod only; a no-op on the dev-stand / CI), and a global exception filter reports 5xx / unexpected errors while leaving client-facing responses unchanged. PII is stripped from every event (request, user, and server context removed; breadcrumbs disabled) per ADR-0011. Self-hosted GlitchTip is the 152-ФЗ-compliant, RF-zone replacement for Sentry SaaS (ADR-0004 §15 / ADR-0005 §10) — DSO-125.

### Patch Changes

- Updated dependencies [[`88514b6`](https://github.com/doctor-school/ds-platform/commit/88514b60c93d47805dcc71539e84f89f8b2edda8)]:
  - @ds/schemas@0.9.0

## 0.12.0

### Minor Changes

- [#321](https://github.com/doctor-school/ds-platform/pull/321) [`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Resend registration verification code ([#319](https://github.com/doctor-school/ds-platform/issues/319), EARS-25): `POST /v1/auth/verify/resend`.

  - **New endpoint** — `POST /v1/auth/verify/resend` takes `{ identifier }` (the email) and re-issues the Zitadel `otp_email` registration verification code **enumeration-safely**: a code is re-issued only for an existing, **unverified** registrant; an unknown identifier or an already-verified one is a silent no-op with an identical ack (`resend_requested`), status, and timing (EARS-16). It is `@Public @RateLimited @TimingEqualized @BotProtected("verify-resend")` like the other abuse-prone unauthenticated surfaces, and appends an `otp.sent` ledger row (EARS-18) only when a code is actually issued — so the ledger is not itself an existence oracle. Lets a registrant whose first code did not arrive re-request it from the existence-agnostic `/verify` screen (EARS-24) without re-typing the password.
  - **New `@ds/schemas` exports** — `VerifyResendRequestSchema` / `VerifyResendRequest` and `VerifyResendResponseSchema` / `VerifyResendResponse` (loose `{ identifier }` contract, like `PasswordResetRequestSchema`).
  - **New IdP port method** — `IdpClient.resendEmailVerification(identifier)` resolves the identifier → Zitadel `sub` internally (mirroring `requestPasswordReset` / `requestEmailOtp`) and re-issues the code only for an existing, unverified registrant, returning a server-side boolean that drives the ledger decision (never reflected into the response). The pre-existing `requestEmailVerification(sub)` is not reused directly because it takes a resolved `sub`, whereas this endpoint receives a raw identifier and the port carries no other targeted lookup.

### Patch Changes

- Updated dependencies [[`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56)]:
  - @ds/schemas@0.8.0

## 0.11.0

### Minor Changes

- [#312](https://github.com/doctor-school/ds-platform/pull/312) [`3cacb44`](https://github.com/doctor-school/ds-platform/commit/3cacb446955cb681dd201614971b24f1fe41c2a2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Auth identity-sync hardening ([#119](https://github.com/doctor-school/ds-platform/issues/119), 003-design §11): wire the periodic reconciliation sweep and harden the Zitadel webhook.

  - **Reconcile scheduler** — `ReconcileScheduler` registers a config-driven `@nestjs/schedule` interval that calls `ReconcileService.sweep()` (the EARS-19 eventual-consistency backstop). Period is `RECONCILE_SWEEP_INTERVAL_MS` (default 15 min; `0` disables); the scheduler guards against overlapping ticks and is fail-soft.
  - **Manual ops trigger** — `pnpm --filter @ds/api reconcile:sweep` boots an HTTP-less Nest context and runs one sweep (`{ reconciled: N }`). Not an HTTP endpoint: v1 has no admin-auth surface.
  - **Constant-time webhook secret check** — the `IDP_WEBHOOK_SECRET` comparison now uses `crypto.timingSafeEqual` (no length oracle, fail-closed preserved), removing a timing side-channel in the prior string compare.
  - **Sweep skips machine/service accounts** — `listUsers()` enumerates Zitadel users without email/phone (e.g. the BFF service user); those are skipped so the `users_email_or_phone` CHECK no longer fails the sweep, and `reconciled` counts only human identities.

## 0.10.0

### Minor Changes

- [#223](https://github.com/doctor-school/ds-platform/pull/223) [`0413ad6`](https://github.com/doctor-school/ds-platform/commit/0413ad67fba93d3a3c10e04e70017ce42aec4319) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Relax password-recovery friction: auto-login after reset + forgiving auth rate-limit ([#221](https://github.com/doctor-school/ds-platform/issues/221), [#222](https://github.com/doctor-school/ds-platform/issues/222), 003 EARS-12/13).

  Two product-owner-approved refinements to feature 003 found in live testing, both
  shipped together.

  **Auto-login after password reset ([#221](https://github.com/doctor-school/ds-platform/issues/221), EARS-12).** Completing a password reset
  no longer drops the user back on `/login`. `POST /v1/auth/password/reset/complete`
  keeps the global force-logout (`revokeAllForSub`) and the `PasswordResetCompleted`
  audit, then mints a **fresh authenticated session** for the subject via the same
  `SessionService.establish` hop login uses — emitting the identical session-created
  `LoginSucceeded` audit row and setting the `__Host-ds_session` cookie. The
  response body stays token-free (`{status:"reset_completed"}`, EARS-8). The IdP
  port's `completePasswordReset` now returns a checked `IdpSession` (the real
  adapter runs a `POST /v2/sessions` password check with the new password; the
  `FakeIdpClient` is no more permissive). The portal `/reset` page routes to
  `/account` on success. A bad/expired code or unknown identifier is unchanged — the
  same generic 400, no session, no existence oracle (EARS-16).

  **Forgiving auth rate-limit ([#222](https://github.com/doctor-school/ds-platform/issues/222), EARS-13, ADR-0001 §7).** The per-user EARS-13
  ceiling is raised **5 → 10 / 15 min** so a normal forgot-password → login recovery
  flow is not throttled mid-journey (per-IP 20/15 min and per-ASN 100/h unchanged).
  A **successful** login AND a **successful** reset-complete now **forgive** (clear)
  the per-user window for that identifier (`RateLimitService.reset({ip, identifier})`,
  keyed identically to the guard), so a recovering user is never stranded. Only the
  per-user window is forgiven — per-IP / per-ASN are deliberately left intact. The
  throttled response stays generic (no account-existence oracle).

## 0.9.0

### Minor Changes

- [#210](https://github.com/doctor-school/ds-platform/pull/210) [`bd2e078`](https://github.com/doctor-school/ds-platform/commit/bd2e07842252e03d52b8912d7441f4cf7e68a446) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Flag-gate the BFF account-exists notice transport on `email-delivery-real` ([#209](https://github.com/doctor-school/ds-platform/issues/209), 003 EARS-23).

  The EARS-23 account-exists notice ([#207](https://github.com/doctor-school/ds-platform/issues/207)/[#208](https://github.com/doctor-school/ds-platform/issues/208)) selected its SMTP transport purely
  from `MAILER_SMTP_*` env, blind to the `email-delivery-real` Unleash flag — so
  flipping the flag moved Zitadel's identity-credential channel to the real relay
  while the BFF notice stayed on Mailpit (an inconsistent, per-channel toggle).

  `SmtpMailer` now carries a **dual transport** — the **Mailpit intercept**
  (`MAILER_SMTP_*`, the dev/test default) and the **real relay** (reusing the
  `IDP_SMTP_REAL_*` creds) — and selects per send from the `email-delivery-real`
  flag read **live** (env default `EMAIL_DELIVERY_MODE === "real"` as the
  Unleash-unreachable fallback), mirroring `DeliveryReconcileService`. One operator
  flag flip now moves **both** channels between Mailpit-intercept and the real relay
  with no restart. Fail-soft: flag ON but `IDP_SMTP_REAL_*` unconfigured ⇒ warn and
  use the intercept (never throws, never silently drops); the selected transport's
  host unset ⇒ the existing logged no-op holds. FakeMailer ↔ SmtpMailer create-time
  parity and the [#207](https://github.com/doctor-school/ds-platform/issues/207) invariants (fire-and-forget, per-address throttle, no
  account/consent/`auth.register` write, EARS-16-identical response) are unchanged.

  `env.schema.ts` gains the optional `IDP_SMTP_REAL_HOST` (carries `host:port`),
  `IDP_SMTP_REAL_PORT`, `IDP_SMTP_REAL_USER`, `IDP_SMTP_REAL_PASSWORD`, and
  `IDP_SMTP_REAL_SENDER_ADDRESS` (`secure` derived from port 465).

- [#191](https://github.com/doctor-school/ds-platform/pull/191) [`c3c73a4`](https://github.com/doctor-school/ds-platform/commit/c3c73a4af9d61f7e3a1636436460e3a9b48323d0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#185](https://github.com/doctor-school/ds-platform/issues/185) migrate runtime feature flags to Unleash + delivery reconcile

  The api now reads three dev-stand runtime flags from Unleash (server SDK,
  `unleash-client`) so an operator toggles them in the Unleash admin UI with no
  `.env.local` edit + restart:

  - `bot-protection` — read **live per request** by the captcha guard/provider. The
    `SmartCaptchaProvider` master switch became an `isEnabled()` callback wired to
    the live flag; `BOT_PROTECTION_ENABLED` is now the bootstrap default and the
    **fail-closed** fallback (an Unleash outage never silently opens the gate).
  - `email-delivery-real` / `sms-delivery-real` — drive a **reconcile**: the api
    does not send OTP email/SMS (Zitadel does, via its active provider), so a flag
    change cannot branch in code — it repoints Zitadel. A new `DeliveryReconcileService`
    reacts to the SDK `changed` event (and reconciles on boot), finds the Zitadel
    provider whose stable `description` matches the desired mode among the
    pre-configured pair (`provision.sh` now ensures BOTH Mailpit + real SMTP and
    both sms-sink + SMS-Aero providers), and calls the admin `…/_activate`. It holds
    no SMTP/SMS secrets (only flips which provider is active), is idempotent
    (already-active ⇒ no-op), and safe (a not-provisioned target ⇒ leave the active
    provider, log a clear note, never activate the wrong one).

  A new `FeatureFlagsService` wraps the SDK behind a `FEATURE_FLAGS` port: reads are
  fail-soft (env default when Unleash is unreachable / the flag is unknown), with a
  clean SDK shutdown on `OnModuleDestroy` (shutdown hooks enabled in `main.ts`). New
  env: `UNLEASH_URL`, `UNLEASH_API_TOKEN`. The delivery flags' boot/Unleash-unreachable
  fallback derives from the existing `EMAIL_DELIVERY_MODE` / `SMS_DELIVERY_MODE` knobs
  (`mode === "real"`) — the SAME vars `provision.sh` uses to activate the boot provider,
  so boot intent and the api fallback share one source of truth (no parallel boolean).
  The SDK + reconcile bind only when their env is present (the shared-CI / fake-IdP
  default runs env-only), so the api test topology is unchanged.

### Patch Changes

- Updated dependencies [[`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67), [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9)]:
  - @ds/schemas@0.7.0

## 0.8.0

### Minor Changes

- [#156](https://github.com/doctor-school/ds-platform/pull/156) [`0de3290`](https://github.com/doctor-school/ds-platform/commit/0de32903ae781ec5f5663807c6e0e3a28fc33c77) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#153](https://github.com/doctor-school/ds-platform/issues/153) wire EARS-6/7 OTP-login against real Zitadel Session v2

  The real Zitadel adapter's four passwordless-login methods — `requestEmailOtp`,
  `loginWithEmailOtp`, `requestSmsOtp`, `loginWithSmsOtp` — were fail-closed seams
  that rejected, so no passwordless login (EARS-6 email / EARS-7 SMS) could
  complete against a real Zitadel; only password login ([#122](https://github.com/doctor-school/ds-platform/issues/122)) and verification
  ([#148](https://github.com/doctor-school/ds-platform/issues/148)) were live-wired. They are now real Session v2 wire calls, the twin of
  [#122](https://github.com/doctor-school/ds-platform/issues/122)/[#148](https://github.com/doctor-school/ds-platform/issues/148).

  The request hop creates a Zitadel session with a `user` check plus an
  `otpEmail`/`otpSms` challenge (`POST /v2/sessions`) so Zitadel dispatches the
  code via its notifier; it is enumeration-safe like `requestPasswordReset` — an
  unknown identifier or any provider error still resolves void, never an existence
  oracle. The verify hop updates the same session with the submitted code
  (`POST /v2/sessions/{id}`) and, on a 2xx, caches the checked-session token via
  `rememberSessionToken` so the shared `exchangeSessionForTokens` hop mints tokens;
  any miss (no live challenge / wrong-or-expired code / unknown identifier) returns
  `null`, all indistinguishable (EARS-16). The cached challenge is deleted only on
  a successful verify (single-use); a failed verify KEEPS it so the user retries
  the SAME already-delivered code against the SAME Zitadel session — matching the
  fake, letting Zitadel natively own the attempt-limit / lockout / code expiry
  (EARS-15), and avoiding a fresh `requestSmsOtp` that would burn a paid SMS send
  and the EARS-14 budget on every typo. The challenge is carried between the two
  port calls by a new `otpChallenges` Map keyed by the lowercased identifier,
  mirroring the existing `sessionTokens` cache — a second hidden cross-request
  state on the singleton adapter that openly ADDS to the [#143](https://github.com/doctor-school/ds-platform/issues/143) (IdpSession port
  widening) debt rather than deepening it silently.

  The exact Session-v2 field names/paths are pinned deterministically by the
  adapter unit spec and AWAIT live confirmation against the dev-stand (the accepted
  [#122](https://github.com/doctor-school/ds-platform/issues/122)→[#145](https://github.com/doctor-school/ds-platform/issues/145)/[#148](https://github.com/doctor-school/ds-platform/issues/148) precedent). A new `IDP_ISSUER`-gated integration spec proves the
  email path end-to-end (request → Mailpit → login → token exchange) and SKIPS in
  CI; the SMS path has no dev-stand provider and is declared honestly as
  unit-pinned-only, not faked green. The `FakeIdpClient`-backed BFF suites are
  unchanged.

### Patch Changes

- [#154](https://github.com/doctor-school/ds-platform/pull/154) [`02773bd`](https://github.com/doctor-school/ds-platform/commit/02773bd6d66c59e8060b50c8768a7e0ac110d724) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(api): [#141](https://github.com/doctor-school/ds-platform/issues/141) keyed HMAC-SHA256 + pepper for audit_ledger identifier_hash

  The `audit_ledger` masked raw identifiers (email / phone) with a bare
  `createHash("sha256")`. Because the identifier space is low-entropy and an
  unkeyed digest is reproducible, the access-controlled ledger became an existence
  oracle — a rainbow table over a phone range trivially confirms whether a given
  identifier appears in a `auth.login.failure` / `auth.otp.sent` /
  `auth.password.reset_requested` row (ADR-0001 §7, ADR-0003 §6).

  `hashIdentifier` is now `HMAC-SHA256(pepper, identifier.toLowerCase())`, so the
  masked value is not reproducible without the server-side secret. The pepper is a
  new optional `AUDIT_IDENTIFIER_PEPPER` env key threaded explicitly into the pure
  mapping (`toLedgerRow` takes the bound mask), resolved once in the
  `DrizzleAuthAuditLog` constructor. The writer **fails closed**: construction
  throws if no pepper is configured in a non-test runtime; under VITEST a fixed
  deterministic test pepper keeps the DB-gated e2e suite runnable without
  provisioning a secret. Per-event ledger behaviour is unchanged — `identifier_hash`
  stays a hex string and no raw identifier ever reaches a row.

## 0.7.0

### Minor Changes

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

- [#142](https://github.com/doctor-school/ds-platform/pull/142) [`6c955c0`](https://github.com/doctor-school/ds-platform/commit/6c955c0c08177a7a86167f6f70d038a5b7599572) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): [#122](https://github.com/doctor-school/ds-platform/issues/122) wire real Zitadel OIDC session→token exchange (003 F2 decision-debt)

  Replaces the fail-closed seam in `ZitadelIdpClient.exchangeSessionForTokens`
  (EARS-8) and `refreshTokens` (EARS-9) with the real OIDC dance against a live
  Zitadel: authorize-with-session → link the checked session
  (`POST /v2/oidc/auth_requests/{id}`) → `authorization_code` token exchange, plus
  the `refresh_token` grant. Principal claims are parsed from the id_token —
  `roles[]` from the Zitadel project-roles claim
  (`urn:zitadel:iam:org:project:roles`) and `mfa` from `amr` — per 003-design §3.

  The exchange requires the OIDC **application** config, now plumbed end-to-end:
  `IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` / `IDP_REDIRECT_URI` / `IDP_SCOPES`
  (`apps/api/src/config/env.schema.ts` → the `IdpModule` factory →
  `ZitadelConfig`). When that config is absent, both paths still fail closed (throw,
  mint nothing) — never an open gate (ADR-0001 §7) — while the rest of the adapter
  is unaffected. `FakeIdpClient` is unchanged (the dev/unit seam). Claim parsing
  and the three-hop wire shape are pinned by `idp/zitadel.idp.spec.ts`; the live
  path is asserted by an `IDP_ISSUER`-gated integration spec that skips in CI and
  until the dev-stand `ds-platform-dev` OIDC app is provisioned. Also records the
  003-design §11 decision that the Zitadel Action webhook authenticates with a
  shared secret (mTLS rejected for v1), feeding [#119](https://github.com/doctor-school/ds-platform/issues/119).

### Patch Changes

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

- [#146](https://github.com/doctor-school/ds-platform/pull/146) [`177eaf8`](https://github.com/doctor-school/ds-platform/commit/177eaf88f33718f6f78d5b7dabc04d90d914159a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(api): [#145](https://github.com/doctor-school/ds-platform/issues/145) send a `profile` on Zitadel `createUser` + live login wire-shape fixes (003)

  First live smoke-test of the real `ZitadelIdpClient` against a dev-stand Zitadel
  v4.15 surfaced three wire-shape deltas masked by the `FakeIdpClient` override in
  every auth e2e:
  1. **`createUser` → 400**: Zitadel v4 requires a `profile` object
     (`givenName`/`familyName`) on `POST /v2/users/human`. Self-service
     registration (EARS-1/2) collects no name (the `users` mirror has no name
     column, design §5), so the adapter now sends a minimal placeholder profile
     (`givenName` = email local-part or `"doctor"`, `familyName` = `"guest"`) —
     a pure adapter detail the domain never reads, mirrors, or surfaces.
  2. **`passwordLogin` rejected**: the `POST /v2/sessions` response does not echo
     the `factors` object live, so the checked user's id (our `sub`) is now read
     via a follow-up `GET /v2/sessions/{id}`.
  3. **OIDC authorize param**: the authorize 302 carries `authRequestID` (capital
     `ID`) live, not the lowercase `authRequest` the merged [#122](https://github.com/doctor-school/ds-platform/issues/122) code parsed.

  No portal-facing contract change — internal Zitadel-adapter fixes only.

  Adds an `IDP_ISSUER`-gated live integration spec
  (`test/auth/zitadel-create-user.e2e-spec.ts`) pinning the `createUser` wire
  shape (creation + the 409 duplicate→`alreadyExisted` enumeration hinge) so the
  delta cannot regress silently; it skips in CI (no `IDP_ISSUER`).

- [#152](https://github.com/doctor-school/ds-platform/pull/152) [`2f56c78`](https://github.com/doctor-school/ds-platform/commit/2f56c7853f670808fb50033f7821201bb2197162) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(api): [#148](https://github.com/doctor-school/ds-platform/issues/148) email/phone-verify resend wire-shape vs live Zitadel v4.15

  First live smoke-test of `ZitadelIdpClient` email/phone verification against a
  dev-stand Zitadel v4.15 surfaced four 404 wire-shape deltas masked by the
  `FakeIdpClient` and the scripted unit double (same class as [#145](https://github.com/doctor-school/ds-platform/issues/145)/[#122](https://github.com/doctor-school/ds-platform/issues/122)). The
  custom-verb paths were renamed to the live REST shapes:

  | Op           | Was (404 live)                         | Now (200 live)                     | Body                          |
  | ------------ | -------------------------------------- | ---------------------------------- | ----------------------------- |
  | email send   | `POST /v2/users/{id}/email/_send_code` | `POST /v2/users/{id}/email/resend` | `{ "sendCode": {} }`          |
  | phone send   | `POST /v2/users/{id}/phone/_send_code` | `POST /v2/users/{id}/phone/resend` | `{ "sendCode": {} }`          |
  | email verify | `POST /v2/users/{id}/email/_verify`    | `POST /v2/users/{id}/email/verify` | `{ "verificationCode": "…" }` |
  | phone verify | `POST /v2/users/{id}/phone/_verify`    | `POST /v2/users/{id}/phone/verify` | `{ "verificationCode": "…" }` |

  The send body is a oneof: `sendCode` routes the code through Zitadel's SMTP
  notifier (→ Mailpit on the dev-stand) and never echoes the secret inline.
  Fail-closed discipline is preserved — a non-2xx send still throws. Email send +
  verify are live-verified via a new `IDP_ISSUER`-gated round-trip e2e (send →
  fetch from Mailpit → verify) that skips in CI; phone paths are aligned by parity
  (the dev-stand has no SMS provider). No portal-facing contract change — internal
  Zitadel-adapter fixes only.

- [#144](https://github.com/doctor-school/ds-platform/pull/144) [`bd74198`](https://github.com/doctor-school/ds-platform/commit/bd74198215d88708092c42656485df6e75509234) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(api): [#122](https://github.com/doctor-school/ds-platform/issues/122) EARS-9 refresh grant omits the project-roles scope (live wire-shape)

  Proving the EARS-8/9 token exchange against a live dev-stand Zitadel (v4.15)
  surfaced a refresh-grant delta in the merged `ZitadelIdpClient.refreshTokens`: it
  sent the full default scope set — including the reserved
  `urn:zitadel:iam:org:project:roles` scope — on the refresh request, which Zitadel
  rejects with `invalid_scope` (per RFC 6749 §6 a refresh may only narrow to a
  subset of the originally-granted scopes). The fix sends **no** `scope` param on the
  refresh grant, which re-issues the full originally-granted set; the project-roles
  claim still rides the rotated id_token via the app's role-assertion config
  (`accessTokenRoleAssertion` / `idTokenRoleAssertion` + `projectRoleAssertion`), so
  `parseIdpClaims` still recovers `roles[]`. With this, the
  `zitadel-token-exchange.e2e-spec.ts` integration spec passes GREEN (EARS-8 + EARS-9)
  against the provisioned dev-stand OIDC app. Unit spec unchanged (it does not assert
  the refresh scope param).

- Updated dependencies [[`2f56c78`](https://github.com/doctor-school/ds-platform/commit/2f56c7853f670808fb50033f7821201bb2197162), [`6109639`](https://github.com/doctor-school/ds-platform/commit/610963971ea88b65796b80b59a571e92def6d9ca)]:
  - @ds/schemas@0.6.0

## 0.6.0

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

### Patch Changes

- Updated dependencies [[`cad6ad3`](https://github.com/doctor-school/ds-platform/commit/cad6ad3c7d1297ecc5a2e05a37d4b2d4b161b9ab), [`03d5d2e`](https://github.com/doctor-school/ds-platform/commit/03d5d2e79ffc84f13b88eac2e34c043e0b3ee294)]:
  - @ds/schemas@0.5.0

## 0.5.0

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

### Patch Changes

- Updated dependencies [[`2db1879`](https://github.com/doctor-school/ds-platform/commit/2db18796e2db751abe31c1f5287c9400fb9e3f84)]:
  - @ds/schemas@0.4.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [[`6e7bd0c`](https://github.com/doctor-school/ds-platform/commit/6e7bd0c30e98f04fe0ccd9f3c93b4f3067006a2e)]:
  - @ds/schemas@0.3.0

## 0.3.0

### Minor Changes

- [#116](https://github.com/doctor-school/ds-platform/pull/116) [`abca9ca`](https://github.com/doctor-school/ds-platform/commit/abca9ca9ee9d7f07dfbaffcbe4d3c131b0bfa14e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api,portal): [#84](https://github.com/doctor-school/ds-platform/issues/84) bootstrap BotProtection abstraction + Yandex SmartCaptcha adapter

  003 is the platform's first consumer of bot protection, so it bootstraps the
  mechanism behind an interface rather than a separate package (design §10.1,
  ADR-0001 open-q [#7](https://github.com/doctor-school/ds-platform/issues/7)). Backend (`@ds/api`): a `BotProtection` provider interface
  (`verify(token, action, clientIp) → ok`) bound to the `BOT_PROTECTION` DI token,
  a Yandex SmartCaptcha adapter (RF-accessible; fail-closed on any error), a
  `@BotProtected(action)` decorator, and a global `BotProtectionGuard` that no-ops
  unless a handler opts in — so swapping the provider (DSO-26) never touches a call
  site. Disabled by default (`BOT_PROTECTION_ENABLED=false`) so the dev-stand runs
  without a Yandex account.

  Frontend (`@ds/portal`): a provider-neutral `BotProtectionField` wrapping a
  self-contained Yandex SmartCaptcha widget that emits the token the guard
  verifies, wired onto the sign-in scaffold. EARS-17 policy (which surfaces, when)
  is owned by 003 F1/F5/F6; this ships the mechanism only. Closes [#84](https://github.com/doctor-school/ds-platform/issues/84).

## 0.2.0

### Minor Changes

- [#62](https://github.com/doctor-school/ds-platform/pull/62) [`275d575`](https://github.com/doctor-school/ds-platform/commit/275d575a0a5878c8a077146971b6e4cc7ce88d11) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api): GET /v1/ready with Postgres + pgvector probes

  Adds a readiness endpoint that probes Postgres (`SELECT 1`) and the pgvector
  extension (`to_regtype('vector')`) via `Promise.allSettled`, returning a
  Zod-validated body (HTTP 200 when both pass, HTTP 503 — same shape — when any
  probe fails). `@ds/schemas` gains `ReadinessResponseSchema` + `CheckStatusSchema`
  (reusable building block for future Redis/MinIO/Centrifugo probes). Closes [#60](https://github.com/doctor-school/ds-platform/issues/60).

### Patch Changes

- Updated dependencies [[`275d575`](https://github.com/doctor-school/ds-platform/commit/275d575a0a5878c8a077146971b6e4cc7ce88d11)]:
  - @ds/schemas@0.2.0

## 0.1.0

### Minor Changes

- [#9](https://github.com/doctor-school/ds-platform/pull/9) [`1fa06ec`](https://github.com/doctor-school/ds-platform/commit/1fa06eccfbb41aae1b0de016f2012874b07a3f9e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Bootstrap `apps/api` (NestJS 11 + Fastify + nestjs-zod, ESM, Node 22) with the first endpoint `GET /v1/health` returning `{ status: 'ok', uptime, timestamp }` via `VersioningType.URI`. Bootstrap `packages/schemas` from stub to host `HealthResponseSchema` — the first Zod entry in the API SSOT (ADR-0002 §3, ADR-0006 §6.2).

### Patch Changes

- Updated dependencies [[`1fa06ec`](https://github.com/doctor-school/ds-platform/commit/1fa06eccfbb41aae1b0de016f2012874b07a3f9e)]:
  - @ds/schemas@0.1.0
