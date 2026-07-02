# `readiness` — readiness probe endpoint

The api's **readiness** probe: `GET /v1/ready` reports whether the process can
actually serve traffic by exercising its critical downstream dependency — the
database. Distinct from the [`health`](../health/README.md) liveness probe, which
only says the process is up; readiness fails when a dependency is down so an
orchestrator holds traffic off an instance that would error. The response shape is
owned by the `@ds/schemas` SSOT (`ReadinessResponseSchema`).

## What's here

| Concern                  | File                      |
| ------------------------ | ------------------------- |
| Module                   | `readiness.module.ts`     |
| Public readiness route   | `readiness.controller.ts` |
| Dependency probe logic   | `readiness.service.ts`    |
| Zod-derived response DTO | `readiness.dto.ts`        |

## Exported symbols

- **`ReadinessModule`** (`readiness.module.ts`) — registers `ReadinessController`
  and provides `ReadinessService`.
- **`ReadinessController`** (`readiness.controller.ts`) — `GET /v1/ready`, marked
  `@Public()` and classified `@Authz({ access: 'public', check: 'none', audit:
'none' })`. On a `down` verdict it throws `503 SERVICE_UNAVAILABLE` with the
  same body (so a probe reads both the status code and the per-check detail);
  otherwise it returns the `ok` body.
- **`ReadinessService`** (`readiness.service.ts`) — runs the checks concurrently
  (`Promise.allSettled`) against the injected `DRIZZLE_POOL` (from the
  [`database`](../database/README.md) module): `SELECT 1` for Postgres liveness
  and `to_regtype('vector')` for the **pgvector** extension (ADR-0003). The
  aggregate `status` is `ok` only when every check is `ok`; any failed or rejected
  check yields `down` for that check and the whole probe.
- **`ReadinessResponseDto`** (`readiness.dto.ts`) — the `createZodDto`-derived DTO
  over `ReadinessResponseSchema` from `@ds/schemas`
  (`packages/schemas/src/readiness/readiness.schema.ts`), so OpenAPI and runtime
  validation share the one schema source.
