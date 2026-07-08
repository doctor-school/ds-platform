---
"@ds/schemas": minor
"@ds/api": minor
---

feat(room): 006 EARS-1 — server-side room admission gate (RoomAccess grant)

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
007 (a tracked seam, parent #576); until 007 lands the gate is built +
E2E-driven against seeded live events with a seeded roster.
