# `authz` — endpoint-authorization classification

Implements the [Endpoint Authorization Matrix design][spec] (E3, #83): the
machine-readable per-endpoint authorization metadata, its runtime enforcement
mirror, and the CI completeness gate. Every backend route must carry a complete,
reviewable authorization classification, or CI fails — the omission an AI agent
is most likely to make (a silently unclassified route) becomes impossible to
merge.

## The four layers (spec §2)

| Layer                     | Here                                                | Role                                                                                         |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **1 — SSOT**              | `@Authz({...})` (`authz.decorator.ts`)              | The single authoring surface. The guard, the gate, and the generator all read this metadata. |
| **2 — completeness gate** | `collectAuthzRows` (`authz.discovery.ts`) + the CLI | Enumerates the **real** router via `DiscoveryService`; fails CI on any missing/invalid row.  |
| **3 — projection**        | `renderMatrix` (`authz.matrix.ts`)                  | Generates `apps/api/docs/endpoint-authz-matrix.md` — for review/audit, never a source.       |
| **runtime mirror**        | `AuthzGuard` (`authz.guard.ts`), global `APP_GUARD` | Reads the same metadata and **fails closed**: an unclassified handler is denied, not served. |

The gate reads the Layer-1 metadata directly (not the `.md`, not the OpenAPI
document — spec §2.1), so the projection can never become a second source of
truth that drifts.

## Authoring a route

```ts
@Post("login")
@Public()                                    // unauthenticated entry point
@Authz({ access: "public", check: "none", audit: "high-stakes", tests: ["EARS-5"] })
async login() {}

@Delete("session")
@Authz({ access: "authenticated", roles: ["doctor_guest"], check: "fast-path",
         audit: "low-stakes", tests: ["EARS-10"] })
async logout() {}
```

Field contract and interdependencies: spec §3 / §3.1 (enforced by `validateRow`).
A `@Public()` handler **still must** carry `@Authz({ access: "public", … })`.

## Regenerating the matrix

The committed `apps/api/docs/endpoint-authz-matrix.md` is generated — do not edit
by hand. After adding or changing a route's `@Authz`, regenerate it (a drift gate
fails CI otherwise):

```bash
pnpm lint:endpoint-authz --generate   # rewrite the matrix
pnpm lint:endpoint-authz              # check mode (what CI runs)
```

The `--tsconfig apps/api/tsconfig.json` flag (baked into the script) is required:
the gate boots the real Nest app, whose DI decorators need
`experimentalDecorators`.

## Seams filled by later work (not E3)

`@Authz` deliberately records intent that downstream subsystems enforce. These
are tracked so they are filled, not forgotten:

- **Audit interceptor.** ADR-0002 §4.8 composes `@Authz` with
  `UseInterceptors(AuditInterceptor)`. The `auth_audit` ledger lands with the
  003 audit subsystem; the `audit` field already records the requirement, and
  the interceptor is wired into `Authz()` when that subsystem exists.
- **Authentication.** Populating the request subject (BFF session / JWT) is 003
  F2 (#86). Until then the guard denies every `access: authenticated` route
  (fail-closed); no such route ships before F2.
- **Policy engine.** `check: "policy"` delegates object-level evaluation to
  `IPolicyEngine` (ADR-0002 §3.2 / DSO-27). The guard fails closed on `policy`
  until the engine is selected; the v1 auth set never uses it (spec §7.2).
- **OpenAPI `x-authz` projection.** Spec §5 also projects the metadata into the
  OpenAPI document. That is wired when the OpenAPI snapshot + `api-drift` job
  land (G8); the `.md` table is the E3 projection.

[spec]: ../../../docs/content/specs/tech/2026-05-18-ds-platform-endpoint-authorization-matrix-design-en.md
