# `health` — liveness probe endpoint

The api's **liveness** probe: a cheap, dependency-free `GET /v1/health` that
reports the process is up and answering. It touches no database or external
service (that is the [`readiness`](../readiness/README.md) probe's job), so an
orchestrator can distinguish "the process is alive" from "the process can serve
traffic". The response shape is owned by the `@ds/schemas` SSOT
(`HealthResponseSchema`); this module only serves a live value against it.

## What's here

| Concern                  | File                   |
| ------------------------ | ---------------------- |
| Module                   | `health.module.ts`     |
| Public liveness route    | `health.controller.ts` |
| Zod-derived response DTO | `health.dto.ts`        |

## Exported symbols

- **`HealthModule`** (`health.module.ts`) — registers `HealthController`; no
  providers (the probe holds no state).
- **`HealthController`** (`health.controller.ts`) — `GET /v1/health`, marked
  `@Public()` and classified `@Authz({ access: 'public', check: 'none', audit:
'none' })` so the endpoint-authz gate passes (an unclassified route is denied).
  Returns `{ status: 'ok', uptime: process.uptime(), timestamp }` — no I/O. When
  `DEPLOY_SHA` is set (baked into the prod container by `pnpm deploy:prod`,
  DSO-127) it also returns `version: '<sha>'`, so an operator can confirm the
  live build over plain HTTP; the field is omitted in local dev / tests.
- **`HealthResponseDto`** (`health.dto.ts`) — the `createZodDto`-derived DTO over
  `HealthResponseSchema` from `@ds/schemas`, so the OpenAPI document and the
  runtime validation share the one schema source
  (`packages/schemas/src/health/health.schema.ts`).
