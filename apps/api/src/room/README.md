# `room` — webinar room admission gate + embed provider (006 EARS-1, EARS-2)

The webinar-room module — the **server-side admission gate** of feature 006
(Webinar room), the foundation the watch side builds on. It hosts the **first
`policy` auth_check** in the webinar domain (004 added the `public` reads, 005
the `fast-path` `doctor_guest` writes/reads).

**EARS-1** lands the gate + the grant vehicle:

- `RoomConfig` read (`GET /v1/events/:idOrSlug/room`) — the server-issued
  **`RoomAccess` grant**, served **only** to a caller the gate admits:
  authenticated **AND** registered for the event (005 `EventRoster`) **AND** the
  event `live`. The grant carries the room identity (`eventId`) and the
  server-config heartbeat cadence N (`heartbeatIntervalSeconds`). A guest, an
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

- `RoomModule` — the Nest module (controller + service + repository + the
  `ROOM_HEARTBEAT_INTERVAL_SECONDS` config binding). Imports `RegistrationModule`
  (the 005 `EventRoster` read).
- `RoomService` — the admission gate (`roomConfig(idOrSlug, sub)`), issuing the
  `RoomConfig` grant on success. Domain errors: `RoomEventNotFoundError` (→ 404),
  `NotRegisteredError` (→ 403), `RoomNotLiveError` (→ 409); the registration
  layer's `UnknownSubjectError` propagates (→ 401).
- `RoomRepository` — the thin read-only `{ id, state, streamConfig }` view of the
  `events` aggregate + its `stream_config` child (the `live` condition + the
  EARS-2 embed source); reads the 004/007 lifecycle state + stream config, never
  writes them.
- `resolveRoomStream` (`provider-enum.ts`) — the pure EARS-2 read: the stream
  config → the grant's `stream`, provider from the closed enum, fail-closed to
  `null` on absent/unknown provider (never URL-sniffed).
- `RoomController` — `GET /v1/events/:idOrSlug/room`, `doctor_guest`-authenticated
  with the resource-scoped `policy` gate (EARS-1, EARS-8).

## Boundaries & tracked seams

- **Sibling handlers layer onto this gate.** The gated commands
  `PostChatMessage` (EARS-3, Centrifugo publish) and `RecordPresenceHeartbeat`
  (EARS-4, durable append-only presence table) evaluate the **same** admission
  decision before any publish/append; the Centrifugo chat token (EARS-3) extends
  the `RoomConfig` shape **additively** (as EARS-2's `stream` already does). EARS-1
  owns the gate and the grant vehicle; the chat/heartbeat commands are not built
  here.
- **Seam → feature 007.** The `live` window (room open/close) and the stream
  config are authored/driven by 007; until 007 lands, the gate is built +
  E2E-driven against **seeded live events with a seeded roster** (tracked on
  parent #576). "Done against the real dependency" = the room opens/closes via
  007 director controls and instantiates the player from 007-authored config.
- **Cadence N is config, not code.** `heartbeatIntervalSeconds` is read from
  `ROOM_HEARTBEAT_INTERVAL_SECONDS` (default 60 s); an operator-confirmed
  different cadence changes config, never the spec or code (design §5).
