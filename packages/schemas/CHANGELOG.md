# @ds/schemas

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
