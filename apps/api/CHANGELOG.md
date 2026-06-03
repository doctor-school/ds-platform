# @ds/api

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
