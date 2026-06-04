# `auth` — BFF over Zitadel (003 F1 + F2 + F4 + F5)

The Backend-for-Frontend for the doctor-portal auth vertical (003-design §1).
`apps/api` owns the domain mirror, consent, RBAC grant, server-side sessions, and
abuse guards; it delegates **every** credential operation to Zitadel through the
`IdpClient` port. This module ships **F1** (#85: registration, verification,
consent capture, mirror sync), **F2** (#86: password login + BFF session
establishment + token exchange), **F4** (#88: session refresh rotation +
logout), and **F5** (#89: password reset — enumeration-safe initiate + complete
with global session revocation).

## What's here

| Concern                                         | File                     | EARS                |
| ----------------------------------------------- | ------------------------ | ------------------- |
| Registration + verify routes                    | `auth.controller.ts`     | 1, 2, 3, 4, 19      |
| Login + session-read routes                     | `auth.controller.ts`     | 5, 8                |
| Refresh + logout routes                         | `auth.controller.ts`     | 9, 10               |
| Password-reset routes                           | `auth.controller.ts`     | 11, 12              |
| Cascade + login + reset orchestration           | `auth.service.ts`        | 1–5, 11, 12, 16, 20 |
| `doctor_guest` mirror row                       | `user-mirror.service.ts` | 3, 4, 19            |
| Reconciliation sweep                            | `reconcile.service.ts`   | 19                  |
| IdP port + adapters                             | `idp/`                   | (design §2)         |
| BFF session establish/refresh/logout/revoke-all | `session/`               | 5, 8, 9, 10, 12     |
| Auth security-event sink (seam)                 | `session/auth-audit.*`   | 9, 10, 12           |

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
- **`AuthAuditLog` port** (`auth-audit.types.ts` / `auth-audit.fake.ts`) — the
  audit-ledger slice for session-security events: `RefreshReuseDetected` /
  `SessionRevoked` (F4) and the user-level `PasswordResetCompleted` (F5/EARS-12).
  In-memory default now; the durable `audit_ledger` writer (EARS-18) rebinds
  `AUTH_AUDIT` in F6 (#90) without touching call sites.
- **`SessionAuthHook`** — a Fastify `onRequest` hook that populates the request
  subject the global `AuthzGuard` reads (the seam in `authz/authz.guard.ts`). It
  is a hook, not a Nest middleware, because Fastify middleware sees the _raw_
  request, invisible to the guard; the hook rejects a cookie whose re-derived
  fingerprint diverges from the bound one.

## The IdP boundary (design §2 — the hard rule)

`idp/idp.types.ts` is the port. Credential verification, OTP send/verify, user
creation, password storage, the session password-check (`passwordLogin`), the
OIDC token exchange (`exchangeSessionForTokens`), and the forgot-password code
flow (`requestPasswordReset` / `completePasswordReset`) are **native Zitadel**,
consumed through this interface and never reimplemented here (Constraints;
ADR-0001 §8, AGPL §13). `apps/api` signs no token and hashes no password. The
binding is chosen once in `idp/idp.module.ts`:

- **`ZitadelIdpClient`** (`idp/zitadel.idp.ts`) — real User v2 API adapter, bound
  when `IDP_ISSUER` + `IDP_SERVICE_TOKEN` are set.
- **`FakeIdpClient`** (`idp/idp.fake.ts`) — in-memory, the default when no
  service token is configured (the dev-stand). Lets the full cascade + login run
  against a real Postgres without a live IdP, which is exactly what the e2e
  suites do (the credential side is not reachable in the shared CI unit job). The
  real adapter's `exchangeSessionForTokens` fails closed until the per-recipe
  OIDC app config is plumbed against the dev-stand Zitadel (design §11, #122).

## Enumeration resistance (EARS-16)

`register`/`verify` return one generic response and one generic 4xx for every
failure (`AuthService.GENERIC_FAILURE`); `login` returns one generic `401` for
every failure (unknown identifier and wrong password are indistinguishable). An
already-registered identifier produces the identical success-shaped response
with no duplicate account; the distinguishing reason never reaches the client (it
belongs in the audit ledger). **Password-reset initiate** (EARS-11) is the same
shape: `reset_requested` whether or not the identifier exists (a code is sent
only if it does), and **complete** returns one generic 400 for a bad/expired
code. Cross-path _timing_ equalization (EARS-16's ≤50 ms budget) is the
cross-cutting concern owned by F6 (#90).

## Seams (not built yet)

- **Login captcha-after-N-failures** (EARS-17 login surface) → F6 (#90). `login`
  is intentionally not yet `@BotProtected` — the failure-count policy is F6's.
- **Audit ledger** (EARS-18) → F6 (#90). Two halves: (a) `@Authz({ audit: … })`
  records the per-route terminal-audit intent — the `auth_audit` writer +
  interceptor land with F6; (b) F4's `AuthAuditLog` port (`AUTH_AUDIT`) already
  emits the `RefreshReuseDetected` / `SessionRevoked` security events into an
  in-memory sink — F6 rebinds it to the durable writer and reconciles the
  EARS-name → canonical `<class>.<event>` wire ids (`auth.token.theft_detected` /
  `auth.session.terminated`, ADR-0001 §7.3).
- **Periodic reconcile schedule** — `ReconcileService.sweep()` is the unit a
  `@nestjs/schedule` cron will call; wiring the trigger is deferred (design §11).

## Constructor-ordering constraint

The endpoint-authz lint gate boots this module under **tsx/esbuild**, which
mis-emits `design:paramtypes` when a type-inferred constructor parameter
precedes an `@Inject(...)` one. Keep `@Inject` params first and any
type-inferred dependency last (see `auth.service.ts` / `auth.controller.ts`).
