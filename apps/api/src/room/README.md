# `room` — webinar room admission gate + embed provider + live chat + heartbeat presence + presence-minute derivation + room-close (006 EARS-1, EARS-2, EARS-3, EARS-4, EARS-5, EARS-7)

The webinar-room module — the **server-side admission gate** of feature 006
(Webinar room), the foundation the watch side builds on. It hosts the **first
`policy` auth_check** in the webinar domain (004 added the `public` reads, 005
the `fast-path` `doctor_guest` writes/reads).

**EARS-1** lands the gate + the grant vehicle:

- `RoomConfig` read (`GET /v1/events/:idOrSlug/room`) — the server-issued
  **`RoomAccess` grant**, served **only** to a caller the gate admits:
  authenticated **AND** registered for the event (005 `EventRoster`) **AND** the
  event `live`. The grant carries the room identity (`eventId`), the
  server-config heartbeat cadence N (`heartbeatIntervalSeconds`), the actual
  go-live instant (`liveAt` — stamped by 007 `OpenRoom`, `null` on a legacy
  `live` row; the room's «В эфире · N мин» pill counts from it, never the
  scheduled `startsAt`, #690), and the live room-presence count (`presenceCount`
  — distinct doctors with a beat inside the freshness window `2 × N`, an
  **aggregate** integer, never per-doctor identity or the roster, #690). A guest, an
  unregistered doctor, or a non-`live` event is refused **server-side** (401 /
  403 / 409) and never receives room content — there is no soft UI wall that
  renders the room for an ungated caller (EARS-1, EARS-8). A direct room URL, a
  shared link, or a crafted/forged-cookie request that fails any of the three
  conditions never yields a grant.

**EARS-2** adds the embed player source to the grant (additively):

- The grant carries `stream` — `{ provider, embedRef } | null` — resolved from the
  event's 007-authored stream config by `resolveRoomStream` (`provider-enum.ts`).
  The provider is read from the **closed enum** (`rutube | youtube`), **never**
  sniffed from the embed reference (the legacy mistake). An absent or unknown
  provider fails **closed** to `stream: null` — the truthful "stream unavailable"
  room state the portal renders, still a valid grant (the gate admitted the
  caller). The `RoomRepository` `LEFT JOIN`s the `stream_config` child so an
  unconfigured `live` event resolves with `streamConfig: null`.

**EARS-4** adds the gated heartbeat command behind the **same** gate:

- `RecordPresenceHeartbeat` (`POST /v1/events/:idOrSlug/heartbeat`) — appends one
  immutable `(doctor, event, instant)` row to the durable **append-only**
  `presence_beats` table and returns a server-authoritative `PresenceHeartbeatAck`
  (`{ eventId, beatAt, presenceCount }` — the ack refreshes the live «N врачей в
  комнате» count on every beat, #690). It evaluates the identical `authenticated ∧ registered
∧ live` gate as the config read (one gate, reused — `RoomService.admit`): a
  guest (401), an unregistered doctor (403), and a non-`live` / `ended` event
  (409) each append **nothing** (EARS-8). The instant is **server-stamped**, never
  a client-supplied count — presence is server-authoritative and durable. The
  client posts on the server-config cadence N (`heartbeatIntervalSeconds` from the
  grant), visibility-gated in the portal (a backgrounded tab emits none). The raw
  beats are the EARS-5 per-doctor-minute derivation's input (coalesced there, not
  suppressed at write time).

**EARS-3** adds the gated chat command + the subscribe-only credential behind the
**same** gate:

- The `RoomConfig` grant carries `chat` — `{ url, token, channel, selfTag } | null`
  (additively, alongside `stream`). The `token` is a Centrifugo connection JWT
  (HS256, HMAC) whose `channels` claim lists **exactly** the caller's room channel
  (`room:event:<id>`) — Centrifugo subscribes the connection **server-side** on
  connect, so it is **gate-scoped** (this one room, no other) and **subscribe-only**
  (the `room` namespace keeps `allow_publish_for_client` off — a client can never
  publish directly). It fails **closed** to `chat: null` when Centrifugo is
  unconfigured (the truthful "chat unavailable" state).
- `PostChatMessage` (`POST /v1/events/:idOrSlug/chat`) — the **only** publish path.
  It evaluates the identical `admit` gate, then publishes a server-authoritative,
  PII-free `RoomChatMessage` (`{ id, authorTag, text, at }` — server `id`/`at`, a
  non-reversible `authorTag` derived from the doctor's domain id, never their roster
  identity, EARS-8) to the room channel over the Centrifugo HTTP API, credentialed
  with the `http_api` key a browser never holds. It fans out to every subscriber in
  real time (no reload). A guest (401), an unregistered doctor (403), and a
  non-`live` / `ended` room (409) publish **nothing** (EARS-8); a Centrifugo outage
  is a 503, never a phantom post.

**EARS-5** derives the per-doctor sponsor minutes from those same beats (read-time,
no new write):

- `PresenceDerivationService.deriveForEvent(eventId, intervalSeconds?)` reads the
  durable append-only `presence_beats` and yields the `EventPresence` read model —
  per-doctor `{ userId, eventId, minutes }`. The minutes are **derived**, never
  stored: `(distinct N-second buckets a doctor emitted a beat in) × N / 60`
  (`PresenceRepository.deriveEventMinutes`, a `count(DISTINCT floor(epoch/N))`
  scan on the composite `(event, user, beat_at)` index).
- **Parameterized over N.** `intervalSeconds` defaults to the server cadence N
  (`ROOM_HEARTBEAT_INTERVAL_SECONDS`); an operator-confirmed different cadence
  recomputes the SAME beats with **no code change** (an explicit override does a
  what-if / re-cadenced export). The returned `intervalSeconds` records which N
  the minutes were computed at.
- **Concurrent tabs never inflate.** A doctor's parallel-session beats for the
  same event land in the same N-second buckets and collapse under `DISTINCT` — two
  tabs beating in one bucket count once, not twice. The coalescing is this
  read-time derivation, not a write-time suppression (every raw beat is still
  durably appended by EARS-4).
- **No public surface (EARS-8).** There is **no** report UI and **no** public
  endpoint in wave 1 — the derivation is never exposed on a public surface, and it
  carries no registrant PII (the per-doctor unit is the opaque domain `userId`
  only, never an email / phone / roster identity). It is a standalone ops read.

### Wave-1 manual sponsor export (the operator recipe)

The first webinar's sponsor report is a **manual export** from this derivation
(design §5) — run the `presence:export` CLI (an HTTP-less Nest context, mirroring
the #119 reconcile CLI), with the dev-stand / production env injected:

```sh
set -a; source ~/.ds-platform/.env.local; set +a
pnpm --filter @ds/api presence:export -- <event-id-or-slug> [intervalSeconds]
```

It prints the `EventPresence` JSON (`{ eventId, intervalSeconds, doctors: [{ userId,
eventId, minutes }] }`) to stdout — the operator hands the per-doctor minutes to
the sponsor. `<event-id-or-slug>` resolves by the same `idOrSlug` the room gate
uses; the optional `[intervalSeconds]` overrides N for a re-cadenced export
(omitted ⇒ the server-config default). The wave-2 auto report «Отчёт партнёра V2»

- auto-NMO consume this same derivation; the exact V2 columns/joins are a wave-2
  owner call.

## The gate — one policy, evaluated server-side

Admission is `authenticated ∧ registered ∧ live` (design §2), evaluated in that
order so the refusal maps to the correct EARS-6 access branch:

1. **Authenticated** — the 003 BFF session. The global `AuthzGuard` refuses an
   unauthenticated caller (401) and any non-`doctor_guest` role (403) before the
   handler runs; a null subject in the handler is defence-in-depth (401).
2. **Registered** — the caller's `(doctor, event)` pair is present in the 005
   `EventRoster`. **Reused, not reimplemented** — the check reads the roster via
   the injected `RegistrationService` (`state()`); 006 adds no registration
   primitive and creates no registration. Absent ⇒ 403 (portal routes to
   register, 005).
3. **Live** — the 004/007-owned `EventLifecycleState` is `live`. Read read-only
   via this module's thin `RoomRepository` view of the `events` aggregate; 006
   reads the state 007 writes, never mutates it. Non-`live` ⇒ 409 (portal shows
   the 004 lifecycle state).

The **`policy`** classification (not `fast-path`) records that the `doctor_guest`
role alone is necessary but **not sufficient** — the registration-and-live gate
is a resource-scoped decision (EARS-8; ADR-0001 §2). There is no object-level
ABAC predicate (`objectAttrs`), so the gate does not depend on the `IPolicyEngine`
(DSO-27): the guard enforces the role precondition and this module's service
evaluates the resource-scoped rule and refuses server-side. See
`authz/README.md` → "Object-level policy engine" for the runtime split.

## Exported symbols

- `RoomModule` — the Nest module (controller + service + repositories + the
  `ROOM_HEARTBEAT_INTERVAL_SECONDS` config binding). Imports `RegistrationModule`
  (the 005 `EventRoster` read).
- `RoomService` — the admission gate (`admit`, reused by both operations),
  `roomConfig(idOrSlug, sub)` issuing the `RoomConfig` grant, and
  `recordHeartbeat(idOrSlug, sub)` appending one beat + returning the ack. Domain
  errors: `RoomEventNotFoundError` (→ 404), `NotRegisteredError` (→ 403),
  `RoomNotLiveError` (→ 409); the registration layer's `UnknownSubjectError`
  propagates (→ 401).
- `RoomRepository` — the thin read-only `{ id, state, streamConfig }` view of the
  `events` aggregate + its `stream_config` child (the `live` condition + the
  EARS-2 embed source); reads the 004/007 lifecycle state + stream config, never
  writes them.
- `PresenceRepository` — the EARS-4 durable append-only presence write:
  `appendBeat(userId, eventId)` (INSERT-only, server-stamped instant) +
  `findUserIdBySub` (the 003 mirror read, read-only) + the EARS-5 read-time
  `deriveEventMinutes(eventId, intervalSeconds)` (the `count(DISTINCT
floor(epoch/N))` per-doctor bucket scan). No update/delete surface — the
  structural half of the append-only contract.
- `PresenceDerivationService` — the EARS-5 per-doctor minute derivation:
  `deriveForEvent(eventId, intervalSeconds?)` → the `EventPresence` read model
  (parameterized over N from `ROOM_HEARTBEAT_INTERVAL_SECONDS` by default,
  concurrent-tab-coalesced). Surfaced by the `presence:export` CLI
  (`presence-export-cli.ts` → `scripts/presence-export.ts`) for the wave-1 manual
  sponsor export — NOT a public endpoint (EARS-8).
- `resolveRoomStream` (`provider-enum.ts`) — the pure EARS-2 read: the stream
  config → the grant's `stream`, provider from the closed enum, fail-closed to
  `null` on absent/unknown provider (never URL-sniffed).
- `CentrifugoChatGateway` (`chat.gateway.ts`) — the EARS-3 chat gateway:
  `credential(userId, eventId)` (mint the gate-scoped subscribe-only connection
  token, or `null` when unconfigured), `publish(eventId, message)` (the sole
  server-mediated publish over the Centrifugo HTTP API), `authorTag(userId)` (the
  stable, non-reversible, PII-free author tag), and `channelForEvent`. Its config
  (`ROOM_CHAT_CONFIG`) is resolved from `CENTRIFUGO_*` env by `resolveRoomChatConfig`
  (`null` ⇒ chat disabled). Domain error: `ChatUnavailableError` (→ 503).
- `RoomController` — `GET /v1/events/:idOrSlug/room` (EARS-1) + `POST
/v1/events/:idOrSlug/heartbeat` (EARS-4) + `POST /v1/events/:idOrSlug/chat`
  (EARS-3), all `doctor_guest`-authenticated with the resource-scoped `policy` gate
  (EARS-8).

## Boundaries & tracked seams

- **Sibling handlers layer onto this gate.** The gated `RecordPresenceHeartbeat`
  command (EARS-4) and `PostChatMessage` (EARS-3) both evaluate the **same** `admit`
  decision before their append / publish, and both extend the `RoomConfig` shape
  **additively** (EARS-4's cadence, EARS-2's `stream`, EARS-3's `chat` credential).
  EARS-5 (`PresenceDerivationService`) reads those same beats at read time (the
  sponsor minutes) — it adds no write and no public surface.
- **Room-close stops capture (EARS-7).** Once the event leaves `live` (the director
  closes the room, feature 007) the shared `admit` gate's `live` condition fails, so
  the grant read, the heartbeat, and the chat post are each refused server-side with
  a `409` carrying the truthful `ended` state — a late beat/post lands nothing, and
  the sponsor minutes (EARS-5) are computed over the beats captured while the room
  was open (a refused-after-close beat never exists). EARS-7 adds no new code path;
  it PINS the close semantics as one coherent story
  (`test/room/room-close.e2e-spec.ts` + the portal `e2e/room-close.spec.ts`
  ended-degradation run).
- **Chat rides Centrifugo (already in the stack).** EARS-3 adds a `room:event:<id>`
  channel + a gate-scoped subscribe-only connection token — **no** new transport.
  The `room` namespace (history + presence, client-publish off) is declared in the
  dev-stand `infra/dev-stand/centrifugo/config.json`; the token HMAC secret is
  `CENTRIFUGO_TOKEN_HMAC_SECRET` (must match the Centrifugo config's
  `client.token.hmac_secret_key`). Centrifugo endpoint/keys are read from
  `CENTRIFUGO_*` env, never hardcoded.
- **Seam → feature 007.** The `live` window (room open/close) and the stream
  config are authored/driven by 007; until 007 lands, the gate is built +
  E2E-driven against **seeded live events with a seeded roster** (tracked on
  parent #576). "Done against the real dependency" = the room opens/closes via
  007 director controls and instantiates the player from 007-authored config.
- **Cadence N is config, not code.** `heartbeatIntervalSeconds` is read from
  `ROOM_HEARTBEAT_INTERVAL_SECONDS` (default 60 s); an operator-confirmed
  different cadence changes config, never the spec or code (design §5).
