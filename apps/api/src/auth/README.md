# `auth` — BFF over Zitadel (003 F1)

The Backend-for-Frontend for the doctor-portal auth vertical (003-design §1).
`apps/api` owns the domain mirror, consent, RBAC grant, and abuse guards; it
delegates **every** credential operation to Zitadel through the `IdpClient`
port. This module ships the **F1** slice (#85): registration, verification,
consent capture, and mirror sync.

## What's here (F1)

| Concern                      | File                     | EARS               |
| ---------------------------- | ------------------------ | ------------------ |
| Registration + verify routes | `auth.controller.ts`     | 1, 2, 3, 4, 19     |
| Cascade orchestration        | `auth.service.ts`        | 1, 2, 3, 4, 16, 20 |
| `doctor_guest` mirror row    | `user-mirror.service.ts` | 3, 4, 19           |
| Reconciliation sweep         | `reconcile.service.ts`   | 19                 |
| IdP port + adapters          | `idp/`                   | (design §2)        |

## The IdP boundary (design §2 — the hard rule)

`idp/idp.types.ts` is the port. Credential verification, OTP send/verify, user
creation, and password storage are **native Zitadel**, consumed through this
interface and never reimplemented here (Constraints; ADR-0001 §8, AGPL §13). The
binding is chosen once in `idp/idp.module.ts`:

- **`ZitadelIdpClient`** (`idp/zitadel.idp.ts`) — real User v2 API adapter, bound
  when `IDP_ISSUER` + `IDP_SERVICE_TOKEN` are set.
- **`FakeIdpClient`** (`idp/idp.fake.ts`) — in-memory, the default when no
  service token is configured (the dev-stand). Lets the full cascade run against
  a real Postgres without a live IdP, which is exactly what the e2e suites do
  (the credential side is not reachable in the shared CI unit job).

## Enumeration resistance (EARS-16)

`register`/`verify` return one generic response and one generic 4xx for every
failure (`AuthService.GENERIC_FAILURE`). An already-registered identifier
produces the identical success-shaped response with no duplicate account; the
distinguishing reason never reaches the client (it belongs in the audit ledger).

## Seams (not built in F1)

- **BFF session / token exchange** (EARS-5,8) → F2 (#86); the `IdpClient` port
  grows the session methods there.
- **Audit ledger** (EARS-18) → F6 (#90). `@Authz({ audit: … })` already records
  the intent per route; the `auth_audit` writer + interceptor land with F6.
- **Periodic reconcile schedule** — `ReconcileService.sweep()` is the unit a
  `@nestjs/schedule` cron will call; wiring the trigger is deferred (design §11).

## Constructor-ordering constraint

The endpoint-authz lint gate boots this module under **tsx/esbuild**, which
mis-emits `design:paramtypes` when a type-inferred constructor parameter
precedes an `@Inject(...)` one. Keep `@Inject` params first and any
type-inferred dependency last (see `auth.service.ts` / `auth.controller.ts`).
