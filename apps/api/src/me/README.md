# `me` — self-scoped profile reads + display name (006 EARS-14/16 · 003 EARS-27)

The self-scoped profile module of feature 006 (Webinar room). It owns the one
thing 006 adds to the caller's own account — a **display name** («Имя и
фамилия»), collected **just-in-time at first room entry** (never at registration
— owner decision 2026-07-11, zero added funnel friction on live prod) and served
back **only to its owner's own session**.

It hosts the **`fast-path` `doctor_guest`** self-service endpoints (a caller
touching only their own record needs no policy evaluation, unlike the room
module's `policy` gate). It owns **no** auth primitive (the global `AuthzGuard` +
the 003 session enforce the `authenticated ∧ doctor_guest` precondition), no
registration, and no event surface.

## Endpoints

- **`GET /v1/me/profile` → `MyProfile` (003 EARS-27).** The **caller's own**
  identity fields projected from the `users` mirror row —
  `{ email, emailVerified, phone, phoneVerified, displayName }` (nullable fields
  are `null`-present, never omitted). Read-only on every path (no writes, no IdP
  call); feeds the portal `/account` profile surface (003 EARS-28). Same
  fail-closed generic 401 + EARS-26 read-path self-heal as the sibling reads.
- **`GET /v1/me/display-name` → `MyDisplayName` (EARS-16).** The **caller's own**
  `{ displayName }` — `null` until the JIT prompt completes. The portal reads it
  to decide the one-time room-entry prompt and to derive the header-avatar
  initials. Never returns another user's name; per-caller ⇒ never
  shared-cacheable.
- **`PUT /v1/me/display-name` → `SetDisplayName` (EARS-14).** Writes the
  **trimmed** name to the caller's own `users.display_name` (the SSOT column).
  An empty / whitespace-only / over-long (>100 chars) value is a **400** at the
  boundary via the `SetDisplayNameRequest` Zod SSOT (`packages/schemas`, the same
  rule the portal JIT prompt enforces). Idempotent overwrite.

Both carry the endpoint-authz classification **`access: authenticated`,
`required_roles: doctor_guest`, `auth_check: fast-path`** (EARS-16; ADR-0001 §2).
The `AuthzGuard` refuses an unauthenticated caller (401) and any non-`doctor_guest`
role (403) before the handler runs — never a silent success.

## Self-only exposure (EARS-16)

Self-only **by construction**: every operation keys strictly on the authenticated
session `sub` — **no method takes a target user id**, so no endpoint can read or
write another doctor's name. The display name is served only to its owner, never
appears on a public surface, and **never flows into a chat payload** — chat
identity stays the non-PII (SHA-256-derived) author tag, owned by the `room`
module. The Zitadel profile placeholder stays never-read.

## Exported symbols

- `MeModule` — wires the controller + service + repository (registered in
  `app.module.ts`).
- `MeController` — the two routes above.
- `MeService` — the domain rules; throws `UnknownSubjectError` (→ 401) when an
  authenticated subject has no 003 `users` mirror row (fail-closed, never a
  fabricated `null`).
- `MeRepository` — the thin `users`-mirror data access (read + `sub`-scoped
  overwrite of `display_name`).

## SSOT & storage

- **Schema SSOT:** `packages/schemas/src/me` — `SetDisplayNameRequestSchema`
  (trimmed, non-empty after trim, ≤100 chars), `MyDisplayNameSchema`
  (`{ displayName: string | null }`) and `MyProfileSchema` (`email`,
  `emailVerified`, nullable-present `phone`/`phoneVerified`/`displayName`).
- **Column:** `users.display_name` (`packages/db`) — one **nullable** column on
  the 003 mirror, no backfill (every existing user hits the JIT prompt on first
  room entry).

## Tests

`apps/api/test/me/profile.e2e-spec.ts` — 003 EARS-27 (own-fields read incl. null
phone/displayName paths, unauthenticated → generic 401, no write on any path).
`apps/api/test/me/display-name.e2e-spec.ts` — EARS-14 (reject empty/whitespace +
unauthenticated, accept + trim onto the caller's own row, over-long reject,
idempotent overwrite) and EARS-16 (owner-only read, one caller never reaches
another's name, and no display name in a chat publish payload). Runs against the
dev-stand Postgres + fake IdP; `skipIf(!DATABASE_URL || !IDP_ISSUER)`.
