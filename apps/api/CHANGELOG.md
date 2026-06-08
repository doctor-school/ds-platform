# @ds/api

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
