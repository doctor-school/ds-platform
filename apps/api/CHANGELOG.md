# @ds/api

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
