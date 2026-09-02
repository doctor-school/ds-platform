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

| Concern                                         | File                          | EARS                                 |
| ----------------------------------------------- | ----------------------------- | ------------------------------------ |
| Registration + verify routes                    | `auth.controller.ts`          | 1, 2, 3, 4, 19                       |
| Login + session-read routes                     | `auth.controller.ts`          | 5, 8                                 |
| Passwordless OTP-login routes                   | `auth.controller.ts`          | 6, 7, 8, 14                          |
| Refresh + logout routes                         | `auth.controller.ts`          | 9, 10                                |
| Password-reset routes                           | `auth.controller.ts`          | 11, 12                               |
| Cascade + login + OTP + reset orchestration     | `auth.service.ts`             | 1–7, 11, 12, 14, 16, 20              |
| SMS toll-fraud budget                           | `sms-budget/`                 | 14                                   |
| Rate limiter (per-user/IP/ASN)                  | `rate-limit/`                 | 13                                   |
| Timing equalization                             | `timing/`                     | 16                                   |
| Login captcha-after-N policy                    | `login-challenge/`            | 17                                   |
| Durable audit_ledger writer                     | `session/auth-audit.*`        | 9, 10, 12, 15, 18                    |
| `doctor_guest` mirror row                       | `user-mirror.service.ts`      | 3, 4, 19, 26                         |
| Reconciliation sweep                            | `reconcile.service.ts`        | 19                                   |
| Read-path mirror self-heal                      | `mirror-self-heal.service.ts` | 26                                   |
| IdP port + adapters                             | `idp/`                        | (design §2)                          |
| BFF session establish/refresh/logout/revoke-all | `session/`                    | 5, 8, 9, 10, 12                      |
| Admin session tier (011)                        | `admin-session/`              | 011: 1, 2, 3, 5, 6, 7, 9, 10, 11, 13 |

## Admin session tier (`admin-session/`, spec 011 — EARS-1/2/3/10)

A **second, stricter cookie tier** beside the portal's, not a second session
model. The structural change: primary authentication at the admin origin no
longer produces a session — it produces a short-lived, server-side **pending
authentication**, and only a satisfied second factor converts that into
`__Host-ds_admin_session` (host-only, `HttpOnly`, `Secure`, `SameSite=Strict`,
opaque reference).

| Concern                                                                              | File                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------- |
| Cookie names/attributes + route-namespace helpers                                    | `admin-session.cookie.ts`             |
| `role → mfa_required` policy (EARS-3)                                                | `mfa-policy.ts`                       |
| Record shapes + the two store ports                                                  | `admin-session.types.ts`              |
| Store adapters (in-memory / Redis)                                                   | `admin-session-store.{fake,redis}.ts` |
| Login → pending → session lifecycle                                                  | `admin-session.service.ts`            |
| Admin-tier request hook (separation + CSRF)                                          | `admin-session-auth.hook.ts`          |
| Second-factor soft-lock counter (011 EARS-7)                                         | `mfa-lockout.service.ts`              |
| `/v1/admin/auth/{login,logout,state}` + `/mfa/verify` + `/mfa/enroll/{start,verify}` | `admin-auth.controller.ts`            |
| `DELETE /v1/admin/users/:id/mfa` — operator factor removal (011 EARS-13)             | `admin-users.controller.ts`           |
| LD-2 break-glass removal (ops CLI half)                                              | `break-glass-cli.ts`                  |
| TOTP registration + login-check seam (Zitadel v2 / fake)                             | `../idp/totp.ts`                      |

Three properties carry it:

1. **Two cookies, enforced apart (EARS-2).** `AdminSessionAuthHook` handles
   `/v1/admin/**` and `SessionAuthHook` handles everything else — disjoint by
   route, so neither can fall back to the other's cookie. A portal cookie on an
   admin route is an explicit refusal with an `auth.session.rejected` row, not an
   accidental miss.
2. **No session without a factor (EARS-3).** The `role → mfa_required` policy is
   evaluated immediately after primary auth; a policy role gets a pending
   reference plus a next step, never a session.
3. **Pending-auth is not a session.** Separate Redis namespace, separate port,
   separate record type, minutes-long TTL — and the admin hook does not know how
   to read it.

**The full second-factor arc is live.** Both verify handlers call
`AdminSessionService` and complete the login **in place** (LD-1), so neither ever
asks for a second sign-in:

- `/mfa/enroll/{start,verify}` (EARS-4/5) serve the `mfa_pending_enrollment`
  branch — the one-time bootstrap every existing admin passes through once;
- `/mfa/verify` (EARS-6) serves `mfa_pending_challenge` — every login after that.
  It checks the code against the **checked Zitadel session** the pending record
  wraps (`IdpClient.checkTotpFactor`, Session-v2 `SetSession`), not against the
  factor in isolation, so the resulting session is MFA-satisfied at the IdP too.
  That call rotates the session token, and the rotated handle is threaded into
  the upgrade — a version that dropped it would fail the OIDC exchange _after_ a
  correct code and report a right code as wrong;
- `GET /v1/admin/auth/state` is the client-readable `AdminAuthState` read the
  admin app routes on: all three admin cookies are `HttpOnly` or authority-free,
  so "login form, enrollment, challenge, or the app?" is a server read by
  construction. It returns the state enum and nothing else — no budget, no lock
  indicator, no subject (011 design §9 → Read models).

`apps/admin` authenticates through this tier end to end (auth /
access-control / data providers, plus the EARS-10 CSRF double-submit header on
every admin write). Release blocker #1204 holds prod deploys of the range until
the journey closes.

### Operator factor recovery (011 EARS-13 / LD-2) — runbook

A `platform_admin` who has lost their authenticator is locked out of a live
medical platform. Recovery in this slice is an **operator action**, not a
self-serve flow (self-serve recovery codes are a tracked follow-up), and it runs
**through our API, never the IdP console** — a console-side removal is not
observed by `apps/api`, so the `auth.mfa.reset` row EARS-9 mandates would never
be written and the trail would have a hole exactly where it matters most.

**The endpoint.** `DELETE /v1/admin/users/:id/mfa`, body `{ "code": "123456" }`.

- `:id` is the **target's** IdP subject — the admin who lost their factor.
- `code` is the **caller's OWN current TOTP code**, not the target's. This is the
  route-local fresh-possession proof: it realises ADR-0001 §10's policy intent
  ("an MFA change is an elevated action and demands fresh MFA") for this one
  route, because the general step-up mechanism has never been built here. The
  route therefore declares `step_up: false` — an honest matrix value beats one
  that advertises a guard nothing enforces.
- Requires a live, MFA-verified `__Host-ds_admin_session` with `platform_admin`,
  plus the EARS-10 CSRF double-submit header (`x-ds-admin-csrf`).
- **When to use it:** an operator lost or replaced their authenticator. After
  removal, the target's next login lands on the forced-enrollment screen
  (EARS-4) and they enrol a fresh factor.
- **A suspected-compromise case needs MORE than this call.** Removing the factor
  only forces re-enrollment at the target's **next** login — it does not end the
  sessions an attacker may already hold, because IdP-side session revocation is
  not built in this slice (tracked as #1205). So for a suspected compromise, run
  the removal AND terminate the target's live sessions through the IdP, or the
  attacker keeps the access the removal was meant to take away.
- **The target must be a `platform_admin`.** `:id` is a raw IdP subject typed by
  the caller, so the route asserts the target is a principal the MFA mandate
  covers (`role → mfa_required`, `mfa-policy.ts`) before deleting anything. A
  target outside the policy draws the uniform 401 — a distinct answer would make
  the endpoint a role oracle over the user population.
- **Refusals.** A wrong / expired / replayed code is the same uniform 401 a
  login-time verify returns, counting against the same per-user rate window and
  the same soft-lock counter — the route is not a code-guessing oracle with a
  budget of its own. Removing your **own** factor is refused (403): it would turn
  the recovery endpoint into an MFA opt-out. An admin-session record predating
  the carried `identifier` also draws the uniform 401 (the §7 per-user window has
  no key without it); logging in again writes a record that carries it.
- **A 503 on this route can mean the factor is ALREADY GONE.** The removal calls
  the IdP first and only then writes the ledger row, and the IdP-side delete is
  followed by a convergence read — so a `503` returned _after_ Zitadel accepted
  the DELETE means the convergence read faulted: the factor is removed, and no
  `auth.mfa.reset` row was appended. Do not treat the 503 as "nothing happened".
  **Retry the same call**: the removal is idempotent, and the retry is what
  closes the ledger. If retries keep faulting, confirm the factor's state at the
  IdP and fall back to the break-glass script below (which writes the same row
  through the same writer) so the trail has no hole.
- **Precondition.** The endpoint presumes **≥2 enrolled `platform_admin`
  operators**. With fewer, nobody can satisfy it — use break-glass below.

**BREAK-GLASS (fewer than two enrolled operators).** The single named exception,
and still not an unobserved path — it writes the same `auth.mfa.reset` row,
through the same writer, with the acting operator in `by_admin`, so a ledger
reader cannot tell it apart from an endpoint removal:

```bash
set -a; source ~/.ds-platform/.env.local; set +a   # or the prod env
pnpm --filter @ds/api break-glass:remove-mfa --target <target IdP sub> --by <acting operator IdP sub>
```

**A post-action note on the tracking Issue is MANDATORY, in the same session as
the removal.** The script cannot capture the one thing the endpoint captures —
proof that the operator who authorised the removal was present — so that proof
becomes a written record instead. The note states: who ran it (a role plus the
IdP subject), whose factor was removed, **why the endpoint could not be used**
(i.e. the enrolled-operator count at the time), and when the target re-enrolled.
A break-glass run with no note is an unrecorded removal of a second factor on a
production medical platform; treat a missing note as an incident, not an
oversight.

## BFF session model (`session/`, design §3, ADR-0001 §6)

The browser holds **only** a `__Host-` cookie; the OIDC tokens live server-side,
keyed by the cookie's `sid`. No token is ever in a response body (EARS-8).

- **`session.cookie.ts`** — the `__Host-` cookie serialize/parse (HttpOnly +
  Secure + SameSite=Lax + `Path=/`, no `Domain` — origin-bound by the prefix) and
  the `hash(UA + IP/24 + accept-language)` fingerprint.
  - **Deploy impact of #1655.** The `IP/24` term is bound ONCE at
    `SessionService.establish` and never rebound, and prod sessions live in Redis
    with a 30 d TTL, so they survive an api restart. Before #1655 the term was
    derived from the Caddy container's /24 — a constant for every visitor; after it,
    the re-derivation on the next request uses the REAL client's /24. Every session
    established before that deploy therefore fails the fingerprint check exactly
    once: on deploy, every signed-in user and every admin operator is signed out and
    signs in again. No data is affected. Ongoing, the binding also evicts a session
    when the client's own /24 changes (cellular roaming, CGNAT reassignment) — the
    ADR-0001 §6 intent, which the constant term had made a no-op. Owner ack of the
    one-time sign-out (2026-09-02):
    https://github.com/doctor-school/ds-platform/pull/1736#issuecomment-5505979858
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
  `audit_ledger` table is natively `RANGE (created_at)` monthly-partitioned
  (#136, ADR-0003 §2.7) — the partition key is carried in the composite PK
  `(id, created_at)` and the composite `event_id` unique `(event_id, created_at)`,
  so `event_id` dedup is scoped within a monthly partition; the writer inserts
  through the partitioned parent and is otherwise unchanged. The in-memory
  `auth-audit.fake.ts` stays the unit-spec double.
- **`SessionAuthHook`** — a Fastify `onRequest` hook that populates the request
  subject the global `AuthzGuard` reads (the seam in `authz/authz.guard.ts`). It
  is a hook, not a Nest middleware, because Fastify middleware sees the _raw_
  request, invisible to the guard; the hook rejects a cookie whose re-derived
  fingerprint diverges from the bound one. Once the subject resolves, the hook
  also runs the EARS-26 read-path mirror self-heal (below) before the handler.
- **`MirrorSelfHealService`** (EARS-26, GH #709) — the third mirror-sync layer
  (webhook primary, sweep backstop, this lazy): an authenticated subject whose
  `users` mirror row is absent (webhook miss/lag inside a sweep interval, or a
  row lost while IdP sessions stay alive) is re-materialized per-sub from
  `IdpClient.getUser(sub)` with the same idempotent upsert + `doctor_guest`
  re-grant the webhook/sweep use — so the orphaned-session state can never
  bounce mirror-backed surfaces into the portal's silent `/login` → `/account`
  carousel via the generic 401. Fail-soft: an unknown-at-IdP or identifier-less
  sub heals nothing and the handler keeps its fail-closed 401; a heal fault
  logs, never throws. Provided (with `UserMirrorService`) in `SessionModule` —
  the auth hook is the earliest consumer in the request lifecycle. Design §4.

## The IdP boundary (design §2 — the hard rule)

`idp/idp.types.ts` is the port. Credential verification, OTP send/verify, user
creation, password storage, the session password-check (`passwordLogin`), the
passwordless OTP-login flows (`requestEmailOtp` / `loginWithEmailOtp` /
`requestSmsOtp` / `loginWithSmsOtp` — `otp_email` / `otp_sms`, design §6), the
OIDC token exchange (`exchangeSessionForTokens`), the forgot-password code
flow (`requestPasswordReset` / `completePasswordReset`), and the TOTP factor
lifecycle (`hasTotpFactor` / `startTotpRegistration` / `verifyTotpRegistration`
in `idp/totp.ts`, plus `terminateSession`) are **native Zitadel**,
consumed through this interface and never reimplemented here (Constraints;
ADR-0001 §8, AGPL §13). `apps/api` signs no token and hashes no password. Each
OTP-login `loginWith…` returns a **checked `IdpSession`** — the same shape
`passwordLogin` yields — so every login variant trades it for tokens via the one
`SessionService.establish` step (design §6 convergence). The binding is chosen
once in `idp/idp.module.ts`:

- **`ZitadelIdpClient`** (`idp/zitadel.idp.ts`) — real User v2 API adapter, bound
  when `IDP_ISSUER` + `IDP_SERVICE_TOKEN` are set. The live-proven Zitadel wire
  shapes and behaviour invariants it encodes (`CreateUser` body, role grant,
  email-requires invariant, `verifysmsotp` limits, delivery-mode verification)
  are pinned in [`idp/README.md`](./idp/README.md).
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
  phone/IP/global — which is the DEPLOYED behaviour today, since no infra layer
  sets `x-asn` (#1655, `DEBT.md`) — the only source today is an untrusted client
  header, i.e. spoofable, though supplying one only adds a dimension counted
  against the sender. The per-IP counter here is keyed on the same
  `request.ip` the EARS-13 limiter uses, i.e. the real client since #1655.
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
  **What the windows do in the deployed system** (#1655) — the per-IP window is
  keyed on `request.ip`, which resolves to the REAL client: the Fastify adapter is
  constructed with `trustProxy` set to the trusted proxy addresses
  (`config/trust-proxy.ts`, `TRUSTED_PROXIES` — loopback + link-local + the
  private ranges by default, i.e. the container network). `x-forwarded-for` is
  therefore honoured from Caddy and from the doctor app's `/v1/:path*` rewrite,
  by ADDRESS rather than by hop count, so both the 1-hop and 2-hop chains resolve
  the same caller; a forwarded header presented by a peer OUTSIDE the trusted set
  is ignored and that request keeps its socket address. The per-ASN window is
  **dormant**: nothing in `infra/**` sets `x-asn` today, so on honest traffic
  `extractAsn` returns undefined and the 100/h ceiling is never evaluated. The
  header has NO trust boundary — Caddy forwards client headers verbatim, so the
  only source today is an untrusted, spoofable client header; there is no exploit
  (a supplied value only adds a dimension counted against the sender), but the
  window must not be read as unreachable. It stays wired for the edge layer that
  will set the header, which must then accept `x-asn` ONLY from the trusted proxy
  set (tracked in `DEBT.md`); no ASN lookup is performed in the api.
- **Timing equalization** (EARS-16) — `timing/` (see above).
- **Login captcha-after-N-failures** (EARS-17) — `login-challenge/`:
  `LoginChallengePolicy` tallies failures per origin; `@LoginChallenged` +
  guard requires a `BotProtection` token once the threshold is crossed (cleared
  on a successful login). A first password attempt is unchallenged; the guard's
  stable `BOT_PROTECTION_REQUIRED` response starts an invisible check in the
  portal and the original values are retried once. Register, OTP request (initial
  and resend), verify resend, and password-reset request (initial and resend) are
  statically `@BotProtected`; verify/OTP confirmation and reset completion are
  deliberately not. Missing and rejected proofs use the shared
  `BOT_PROTECTION_REQUIRED` / `BOT_PROTECTION_REJECTED` codes, never provider text.
- **Account lockout** — two different mechanisms behind one canonical wire id
  (`auth.lockout.triggered`), told apart by the row's `reason`:
  - **Password lockout** (003 EARS-15, `reason: "lock"`) — a native Zitadel
    policy. The BFF only _observes_ the `locked` verdict from
    `IdpClient.passwordLogin` and emits the row; the counter, the lock, and the
    notification email are all native.
  - **Second-factor lockout** (011 EARS-7, `reason: "mfa_attempts"`) — **the
    BFF's own**, in `admin-session/mfa-lockout.service.ts`: 10 failed TOTP
    verifies / 30 min, keyed by IdP subject, shared across the enrollment and
    challenge surfaces. It is ours because Zitadel exposes no per-subject
    TOTP-attempt lock to observe — its verify answers a bare accept/refuse — so
    an "observe it" design would be a clause with nothing behind it. The lock is
    checked **before** the code is sent to the IdP, which is what makes "the lock
    beats a correct code" structural rather than a branch after the verify; it
    expires with its own 30-minute window, and a satisfied factor clears the
    tally. The notification is ours too (`Mailer.sendAdminLockoutNotice`), sent
    **fire-and-forget**: an SMTP round-trip inside the threshold-crossing request
    would make attempt #10 measurably slower than #1-9 and rebuild the timing
    oracle the ≤50 ms band exists to close.
- **Audit ledger** (EARS-18) — see the `AuthAuditLog` port above.

## Auth failure observability + incident runbook (#1112)

A **rejected** verify / password-reset-complete used to be recorded NOWHERE on our
side: `auth.service.ts` audited success only, and Zitadel's `*.check.failed`
eventstore rows carry a null payload — so diagnosing "the code was rejected / the
account never verified" needed raw SSH `psql`. Two failure branches now append a
reason-coded, PD-safe observability row through the same `AuthAuditLog` port used
for success (no ad-hoc `Logger` lines — the ledger is queryable and already
PD-masked):

| Command                 | Failure event         | Wire id (`toLedgerRow`)      | Reason(s)               |
| ----------------------- | --------------------- | ---------------------------- | ----------------------- |
| `verify` (EARS-3)       | `VerifyFailed`        | `auth.account.verify_failed` | `no-account`, `invalid` |
| `completePasswordReset` | `PasswordResetFailed` | `auth.password.reset_failed` | `invalid`               |

Each row is **identifier-keyed** (`subject_id` NULL; the raw identifier is masked
to an `identifier_hash` by the writer, exactly like `LoginFailed` — never raw PD)
and carries **no one-time code** (003 EARS-30). The client outcome is unchanged: the
same generic 400 for every failure (EARS-16). Timing safety here is by **symmetry**,
NOT the interceptor: `/verify` and `/password/reset/complete` are code-gated routes
that are **not** under the EARS-16 ≤50 ms floor — they carry no `@TimingEqualized`,
and 003-requirements-en.md:207 does not list them (unlike register/login/otp/reset).
So the guarantee is that each failure write is a single awaited INSERT that **mirrors
the success-path write** (same ledger hop, no extra network I/O), introducing no new
timing differential between the success and failure paths. Any future heavier
failure-path write (an extra query, a counter round-trip) would break that symmetry
and must be re-evaluated — see the read-time attempt-count note below, which
deliberately keeps the write path to that single INSERT.

**Port limitation (deliberate, not a stub).** The IdP port returns only a boolean
(`verifyEmail → bool`) / a session-or-null (`completePasswordReset`), so the granular
Zitadel reason (wrong / expired / superseded) is **not observable** at the BFF and
collapses to `invalid`; `no-account` is the one distinction the BFF itself owns (no
mirror row on the verify path). The `AuthFailureReason` union is intentionally narrow
(`invalid | no-account`) — widen it only when a port method starts exposing the finer
distinction, never speculatively (AGENTS.md §6).

**Attempt counter — derived at read time, not stored.** Counting failures per
identifier is a read-side aggregation over these rows (grouping on `identifier_hash`),
so nothing rides the row and the failure path stays a single INSERT (no new infra, no
Redis counter, no extra write-path hop — the EARS-16 constraint). Query our own
`audit_ledger` FIRST in any incident:

```sql
-- reason-coded failures + per-identifier attempt counts in the window
SELECT metadata->>'identifier_hash' AS id_hash,
       event_type, reason, count(*) AS attempts, max(created_at) AS last_at
  FROM audit_ledger
 WHERE event_type IN ('auth.account.verify_failed','auth.password.reset_failed')
   AND created_at >= now() - interval '24 hours'
 GROUP BY 1, 2, 3
 ORDER BY attempts DESC;
```

**Zitadel-side view (`tools/ops/auth-events.mjs`).** For the lower-level identity
events the ledger cannot enrich (the null-payload `*.check.failed`, code add/sent,
native lockout), a **read-only** ops script replaces the ad-hoc SSH SQL. The DSN is
read from `--dsn` / `$AUTH_EVENTS_DSN` (the **Zitadel** database, a separate DB from
`DATABASE_URL`) and is never hardcoded; every query runs in a `READ ONLY`
transaction. See `node tools/ops/auth-events.mjs --help`.

> **TODO (AC #3 — Loki confirm):** verify these `audit_ledger` failure rows ship to
> Loki alongside the app logs so an operator can alert on `auth.account.verify_failed`
> spikes without DB access. Wiring + confirmation are owned by the log-shipping
> pipeline in the [engineering-readiness spec](../../../docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md)
> (Loki/Promtail); tracked separately from this observability change.

## Reconciliation sweep schedule + depth (built — #119, #753)

- **Periodic reconcile schedule** — `ReconcileScheduler` registers a config-driven
  `@nestjs/schedule` interval that calls `ReconcileService.sweep()` (the EARS-19
  eventual-consistency backstop). The period is `RECONCILE_SWEEP_INTERVAL_MS`
  (default 15 min; `0` disables); the scheduler guards against overlapping ticks
  and is fail-soft. A standalone-Nest CLI (`pnpm --filter @ds/api reconcile:sweep`)
  is the ops manual trigger — not an HTTP endpoint, since v1 has no admin-auth
  surface. Operating detail: `apps/docs/content/operations/auth-operations.md`.

- **Conflict-resolution policy (#753, design §11)** — Zitadel is the identity SoT
  (ADR-0001), so `UserMirrorService.upsert` resolves a mirror-vs-Zitadel
  divergence **Zitadel-wins** on the identity fields and **mirror-owns** the
  local projection:

  | Field(s)                                             | Owner       | On sweep                         |
  | ---------------------------------------------------- | ----------- | -------------------------------- |
  | `email`, `phone`, `email_verified`, `phone_verified` | **Zitadel** | overwritten (Zitadel-wins)       |
  | `role`                                               | **mirror**  | preserved (local authz seam)     |
  | `id`, `created_at`                                   | **mirror**  | preserved                        |
  | `deactivated_at`                                     | **mirror**  | cleared on upsert (reactivation) |

  When an upsert actually changes an identity field on an existing row, the sweep
  appends an **`auth.reconcile.divergence`** audit event (`AUTH_AUDIT`) carrying
  only the **changed field names** — never the values (PD-minimal, ADR-0001 §7 /
  ADR-0003 §6). A brand-new row and a no-op pass emit nothing.

- **Soft-delete / deactivation (#753)** — a user Zitadel reports **inactive**
  (`state != USER_STATE_ACTIVE`), or one **absent** from the fully-paginated
  `listUsers()` enumeration (hard-deleted at the IdP), has its still-active mirror
  row soft-deleted (`users.deactivated_at = now()`, `UserMirrorService.softDelete`)
  and is **not** re-granted `doctor_guest`. A user that reappears active is
  **reactivated** (its `deactivated_at` cleared) on the next upsert. Rows are
  **never hard-deleted** — the `audit_ledger` / `consent_records` / `registrations`
  / session references and the `users_email_or_phone` CHECK require identifiers to
  persist. Two safety guards keep a failed enumeration from wiping the mirror: the
  real adapter's `listUsers()` **throws** on a non-2xx (an outage must not read as
  "zero users") and paginates in full (a >100-user page must not truncate), and the
  sweep **skips** the absent-row pass on an empty enumeration.

  > `deactivated_at` is a downstream **projection flag, NOT an authz gate** — it is
  > deliberately not wired into `AuthzGuard` or the login path. Authz stays
  > Zitadel-token-driven; a Zitadel-deactivated user already cannot obtain tokens,
  > so gating on this column would only add a redundant, drift-prone second gate.
  > Hard-purge / GDPR erasure of soft-deleted rows is out of 003 scope.

## Constructor-ordering constraint

The endpoint-authz lint gate boots this module under **tsx/esbuild**, which
mis-emits `design:paramtypes` when a type-inferred constructor parameter
precedes an `@Inject(...)` one. Keep `@Inject` params first and any
type-inferred dependency last (see `auth.service.ts` / `auth.controller.ts`).

The failure is **silent**: `pnpm lint:endpoint-authz` exits 1 with no
stdout/stderr (the gate boots Nest with the logger off), while tsc and Vitest
tolerate either order — so typecheck and tests stay green and only the gate
crashes. To see the real `UndefinedDependencyException`, boot
`scanRealRouteSet()` (`src/authz/authz.gate.ts`) yourself with the Nest logger
enabled.
