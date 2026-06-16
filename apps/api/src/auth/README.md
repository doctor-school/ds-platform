# `auth` — BFF over Zitadel (003 F1 + F2 + F3 + F4 + F5 + F6)

The Backend-for-Frontend for the doctor-portal auth vertical (003-design §1).
`apps/api` owns the domain mirror, consent, RBAC grant, server-side sessions, and
abuse guards; it delegates **every** credential operation to Zitadel through the
`IdpClient` port. This module ships **F1** (#85: registration, verification,
consent capture, mirror sync), **F2** (#86: password login + BFF session
establishment + token exchange), **F3** (#87: passwordless login — email-OTP +
SMS-OTP + SMS toll-fraud budget), **F4** (#88: session refresh rotation +
logout), **F5** (#89: password reset — enumeration-safe initiate + complete with
global session revocation), and **F6** (#90: cross-cutting security — rate limit,
timing equalization, login captcha policy, native-lockout observation, and the
durable `audit_ledger` writer).

## What's here

| Concern                                         | File                     | EARS                    |
| ----------------------------------------------- | ------------------------ | ----------------------- |
| Registration + verify routes                    | `auth.controller.ts`     | 1, 2, 3, 4, 19          |
| Login + session-read routes                     | `auth.controller.ts`     | 5, 8                    |
| Passwordless OTP-login routes                   | `auth.controller.ts`     | 6, 7, 8, 14             |
| Refresh + logout routes                         | `auth.controller.ts`     | 9, 10                   |
| Password-reset routes                           | `auth.controller.ts`     | 11, 12                  |
| Cascade + login + OTP + reset orchestration     | `auth.service.ts`        | 1–7, 11, 12, 14, 16, 20 |
| SMS toll-fraud budget                           | `sms-budget/`            | 14                      |
| Rate limiter (per-user/IP/ASN)                  | `rate-limit/`            | 13                      |
| Timing equalization                             | `timing/`                | 16                      |
| Login captcha-after-N policy                    | `login-challenge/`       | 17                      |
| Durable audit_ledger writer                     | `session/auth-audit.*`   | 9, 10, 12, 15, 18       |
| `doctor_guest` mirror row                       | `user-mirror.service.ts` | 3, 4, 19                |
| Reconciliation sweep                            | `reconcile.service.ts`   | 19                      |
| IdP port + adapters                             | `idp/`                   | (design §2)             |
| BFF session establish/refresh/logout/revoke-all | `session/`               | 5, 8, 9, 10, 12         |

## BFF session model (`session/`, design §3, ADR-0001 §6)

The browser holds **only** a `__Host-` cookie; the OIDC tokens live server-side,
keyed by the cookie's `sid`. No token is ever in a response body (EARS-8).

- **`session.cookie.ts`** — the `__Host-` cookie serialize/parse (HttpOnly +
  Secure + SameSite=Lax + `Path=/`, no `Domain` — origin-bound by the prefix) and
  the `hash(UA + IP/24 + accept-language)` fingerprint.
- **`SessionStore` port** (`session.types.ts`) — the `ActiveSession` read model.
  Bound once in `session.module.ts`: the **Redis adapter**
  (`session-store.redis.ts`) when `REDIS_URL` is set (the production binding),
  else the **in-memory fake** (`session-store.fake.ts`) — the CI / dev-stand
  default, so the suite runs without a live Redis (mirrors the IdP fake/real
  split).
- **`SessionService`** — the single session-establishment step (OIDC exchange →
  `sid` → server-side record → `__Host-` cookie); every login variant (password
  F2, OTP F3) converges here (design §6). Also owns **refresh rotation**
  (`refresh` → single-use IdP exchange + `SessionStore.rotate`; RFC-6819 reuse →
  `SessionStore.delete` + `RefreshReuseDetected`, EARS-9), **logout**
  (`logout` → `SessionStore.delete` + cleared cookie + `SessionRevoked`, EARS-10),
  and **global revocation** (`revokeAllForSub` → `SessionStore.deleteBySub` +
  `PasswordResetCompleted`, the EARS-12 session-side effect of a completed reset —
  a credential change must leave no live session behind, ADR-0001 §6/§7). The
  store keeps a `sub → sids` index so the revoke is targeted, not a scan.
- **`AuthAuditLog` port** (`auth-audit.types.ts`) — the EARS-18 audit-ledger
  seam. F6 (#90) expanded the event vocabulary to the full taxonomy (register,
  login success/failure, otp.sent, rotate, reuse, logout, reset
  requested/completed, lockout), reconciled each internal name to its canonical
  `auth.<class>.<event>` wire id in one place (`auth-audit.ledger.ts:toLedgerRow`,
  ADR-0001 §7.3), and bound `AUTH_AUDIT` to the durable `DrizzleAuthAuditLog`
  writer (append-only `audit_ledger`, PD masked to `identifier_hash`). The
  in-memory `auth-audit.fake.ts` stays the unit-spec double.
- **`SessionAuthHook`** — a Fastify `onRequest` hook that populates the request
  subject the global `AuthzGuard` reads (the seam in `authz/authz.guard.ts`). It
  is a hook, not a Nest middleware, because Fastify middleware sees the _raw_
  request, invisible to the guard; the hook rejects a cookie whose re-derived
  fingerprint diverges from the bound one.

## The IdP boundary (design §2 — the hard rule)

`idp/idp.types.ts` is the port. Credential verification, OTP send/verify, user
creation, password storage, the session password-check (`passwordLogin`), the
passwordless OTP-login flows (`requestEmailOtp` / `loginWithEmailOtp` /
`requestSmsOtp` / `loginWithSmsOtp` — `otp_email` / `otp_sms`, design §6), the
OIDC token exchange (`exchangeSessionForTokens`), and the forgot-password code
flow (`requestPasswordReset` / `completePasswordReset`) are **native Zitadel**,
consumed through this interface and never reimplemented here (Constraints;
ADR-0001 §8, AGPL §13). `apps/api` signs no token and hashes no password. Each
OTP-login `loginWith…` returns a **checked `IdpSession`** — the same shape
`passwordLogin` yields — so every login variant trades it for tokens via the one
`SessionService.establish` step (design §6 convergence). The binding is chosen
once in `idp/idp.module.ts`:

- **`ZitadelIdpClient`** (`idp/zitadel.idp.ts`) — real User v2 API adapter, bound
  when `IDP_ISSUER` + `IDP_SERVICE_TOKEN` are set.
- **`FakeIdpClient`** (`idp/idp.fake.ts`) — in-memory, the default when no
  service token is configured (the dev-stand). Lets the full cascade + login run
  against a real Postgres without a live IdP, which is exactly what the e2e
  suites do (the credential side is not reachable in the shared CI unit job).

The real adapter's `exchangeSessionForTokens` (EARS-8) and `refreshTokens`
(EARS-9) implement the full OIDC dance — authorize-with-session → link the
checked session (`POST /v2/oidc/auth_requests/{id}`) → `authorization_code` token
exchange, and the `refresh_token` grant — parsing `roles[]` (the
`urn:zitadel:iam:org:project:roles` claim) and `mfa` (from `amr`) from the
id_token. They require the OIDC **application** config (`IDP_CLIENT_ID` /
`IDP_REDIRECT_URI` / optional secret + scopes); absent that config those two
paths fail closed (throw, mint nothing) while the rest of the adapter still
works. The wire shape and claim parsing are pinned by `idp/zitadel.idp.spec.ts`;
`test/auth/zitadel-token-exchange.e2e-spec.ts` asserts the live path, gated on
`IDP_ISSUER` (skips in CI / until the dev-stand `ds-platform-dev` OIDC app is
provisioned — `infra/dev-stand/idp/bootstrap.md`, #122). The four OTP-login
methods remain documented seams of the **same** kind (a session-bound challenge
plus the same exchange) and fail closed until exercised against a live instance;
the BFF OTP orchestration (EARS-6/7) and the SMS budget (EARS-14) are proven
against `FakeIdpClient`.

## SMS toll-fraud budget (`sms-budget/`, EARS-14, design §10)

SMS itself is sent **natively by Zitadel** (`otp_sms`); the BFF owns the custom
half of the split (design §2): a circuit-breaker that gates **before** asking the
IdP to send, so a refused send never reaches the provider and never costs money.

- **`SmsBudgetService`** — four fixed-window counters: per-phone (3/h), per-IP
  (10/h), per-ASN (100/h), and a global daily breaker (≤2000/day). `tryConsume`
  allows a send only when **every** applicable window has room and consumes
  **nothing** on refusal (the SMS never went out). A `globalPerDay` of 0 is a
  tripped breaker that refuses the first send.
- **Where it gates** — `AuthService.requestLoginOtp` calls it on the `sms`
  channel only; a refusal is a generic `429` (`GENERIC_THROTTLED`) that names no
  threshold and no account (not an existence oracle, EARS-16/§10). The per-ASN
  window is evaluated only when the edge supplies an `x-asn` header (the per-ASN
  limit is an edge/BFF concern, design §2); absent it, the budget degrades to
  phone/IP/global.
- **State** — in-memory (correct for a single instance, proven by the unit spec +
  OTP e2e). Multi-instance sharing rides the same Redis as the session store; the
  EARS-13 `RateLimitService` (F6 #90) is the parallel request-rate limiter sharing
  that same in-memory→Redis seam. Rebinding either leaves the call sites untouched
  (the SESSION_STORE fake/Redis pattern). Thresholds are an injectable
  value (`SMS_BUDGET_THRESHOLDS`) so a deployment can tighten them and the e2e can
  drive the breaker boundary without 2000 round-trips; the clock
  (`SMS_BUDGET_CLOCK`) is `Date.now`, faked in the unit spec for window-reset
  determinism. **Decision-debt:** EARS-14 also covers registration **verification**
  SMS (EARS-2), whose send-site is not yet gated — see #87's follow-up.

## Enumeration resistance (EARS-16)

`register`/`verify` return one generic response and one generic 4xx for every
failure (`AuthService.GENERIC_FAILURE`); `login` returns one generic `401` for
every failure (unknown identifier and wrong password are indistinguishable). An
already-registered identifier produces the identical success-shaped response
with no duplicate account; the distinguishing reason never reaches the client (it
belongs in the audit ledger). **Password-reset initiate** (EARS-11) is the same
shape: `reset_requested` whether or not the identifier exists (a code is sent
only if it does), and **complete** returns one generic 400 for a bad/expired
code. Cross-path _timing_ equalization (EARS-16's ≤50 ms budget) is enforced by
the `@TimingEqualized` `TimingEqualizationInterceptor` (`timing/`), which floors
register/login/otp/reset to a fixed minimum on success **and** failure so the
existing/unknown delta collapses to jitter (F6 #90).

## Cross-cutting security (F6 #90)

The mandatory v1 baseline (ADR-0001 §7) is enforced as additive global guards /
interceptor that no-op on unmarked handlers (the `@BotProtected` pattern), so each
gate touches no other call site:

- **Rate limiting** (EARS-13) — `rate-limit/`: `@RateLimited` + a global guard
  over `RateLimitService` (per-user 10/15 min, per-IP 20/15 min, per-ASN 100/h;
  the per-user window is forgiven on a successful login or reset-complete),
  on register/login/otp/verify/reset; a refusal is a generic `429`.
- **Timing equalization** (EARS-16) — `timing/` (see above).
- **Login captcha-after-N-failures** (EARS-17) — `login-challenge/`:
  `LoginChallengePolicy` tallies failures per origin; `@LoginChallenged` +
  guard requires a `BotProtection` token once the threshold is crossed (cleared
  on a successful login). The OTP-request surface is now statically
  `@BotProtected("otp-request")` (closes #129's email-OTP abuse gap).
- **Account lockout** (EARS-15) — native Zitadel policy; the BFF only _observes_
  the `locked` verdict from `IdpClient.passwordLogin` and emits
  `auth.lockout.triggered`. The counter, lock, and notification email are native.
- **Audit ledger** (EARS-18) — see the `AuthAuditLog` port above.

## Seams (not built yet)

- **Periodic reconcile schedule** — `ReconcileService.sweep()` is the unit a
  `@nestjs/schedule` cron will call; wiring the trigger is deferred (design §11).

## Constructor-ordering constraint

The endpoint-authz lint gate boots this module under **tsx/esbuild**, which
mis-emits `design:paramtypes` when a type-inferred constructor parameter
precedes an `@Inject(...)` one. Keep `@Inject` params first and any
type-inferred dependency last (see `auth.service.ts` / `auth.controller.ts`).
