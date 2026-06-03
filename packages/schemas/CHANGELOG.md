# @ds/schemas

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
