---
title: "001 — apps/api bootstrap + GET /v1/health"
description: "Requirements: scaffold apps/api as NestJS 11 + Fastify + nestjs-zod and expose GET /v1/health (status, uptime, timestamp). First feature spec, first use of @ds/schemas as Zod SSOT."
slug: 001-api-bootstrap-health
status: In dev
tracker: https://github.com/doctor-school/ds-platform/milestone/1
parent_issue: https://github.com/doctor-school/ds-platform/issues/7
prior_decisions:
  - ADR-0002 — Backend Core Stack
  - ADR-0006 — Documentation & SSOT
  - ADR-0008 — Repo Strategy & Dev Workflow
lang: en
---

# 001 — apps/api bootstrap + GET /v1/health (Requirements)

## Outcomes

- `apps/api` graduates from stub state to a runnable NestJS 11 + Fastify application.
- Operators and uptime probes have a public liveness endpoint `GET /v1/health` returning `{ status, uptime, timestamp }`.
- The Zod single-source-of-truth pipeline (ADR-0002 §3, ADR-0006 §3) is exercised end-to-end for the first time: a schema in `@ds/schemas` is consumed by the API and validated in a Vitest e2e test.

## Scope

**In:**

- Bootstrap `apps/api` with NestJS 11 + `@nestjs/platform-fastify` + `nestjs-zod`.
- Bootstrap `packages/schemas` from stub: export `HealthResponseSchema` and `HealthResponse` type.
- Implement `HealthModule` / `HealthController` serving `GET /v1/health` via `VersioningType.URI`.
- Wire `dev` / `build` / `start` / `test` / `typecheck` / `lint` scripts so Turbo picks them up.
- One Vitest + supertest e2e test asserting EARS-1.

**Explicitly out** (each becomes a separate follow-up):

- `/v1/health/ready`, `/v1/health/live` separation; database / Redis / BullMQ probes.
- Swagger UI, OpenAPI JSON, `@ds/api-client` generation.
- helmet, throttler, pino, CORS, global exception filter.
- `@ds/eslint-config` drift-rule against `class-validator` / `@ApiProperty`.
- Dockerfile, Coolify wiring, CI job for api e2e.

## Constraints

- Node.js 22 LTS, TypeScript strict, ESM-only — per ADR-0002 §1 and root `package.json`.
- Path-based versioning `/v1/...` via NestJS native `VersioningType.URI` — per ADR-0002 design §line 293 (`@Controller({ path, version: '1' })`).
- Zod schema location: `packages/schemas/` (SSOT) — per ADR-0006 §6.2 ("Do not change public API without updating `packages/schemas/<module>` in same PR").
- Validation library: `nestjs-zod` by risenforces — exact package name fixed by ADR-0002 §3.
- Test runner: Vitest + supertest — per ADR-0002 design §QA matrix.
- `@ds/schemas` must remain framework-agnostic (depends on `zod` only, no `nestjs-zod` / `@nestjs/*`) so `apps/portal` and `apps/mobile` can consume it without pulling Nest into the client bundle (ADR-0005 §«100% reuse»).

## Prior decisions

- **ADR-0002** Backend Core Stack — fixes Node 22 + NestJS 11 + Fastify + `nestjs-zod` + Vitest.
- **ADR-0006** Documentation & SSOT — `packages/schemas/` as API SSOT; feature-spec triplet location and structure.
- **ADR-0008** Repo Strategy & Dev Workflow — workspace layout, `tsconfig.base.json`, Turbo task graph, phased rollout (G3 → G5 → G9).

## Event Model

This feature exposes a synchronous query handler, not an aggregate. No commands, no events, no policies — only one read model.

| Element       | Name             | Notes                                                          |
| ------------- | ---------------- | -------------------------------------------------------------- |
| Read model    | `HealthResponse` | `{ status: 'ok', uptime: number, timestamp: ISO8601 string }`. |
| Query handler | `GET /v1/health` | Returns `HealthResponse` synchronously, no I/O.                |

## EARS requirements

> **Numbering convention used here:** this spec has a single requirement, so the flat ID `EARS-1` is used as shorthand for `EARS-1.1` (the `N.M` form mandated by AGENTS.md §6 / ADR-0007 §2.6). When a second requirement appears in this feature, the existing one becomes `EARS-1.1` and the new one `EARS-1.2`. The `ears-tests` CI guard is content-match WARN in Phase 0, so the shorthand does not regress.

- **EARS-1:** When the client sends `GET /v1/health`, the system shall respond with HTTP 200 and a JSON body conforming to `HealthResponseSchema` (`status === 'ok'`, `uptime` as non-negative seconds since process start, `timestamp` as a valid ISO-8601 UTC datetime ending in `Z` — the output of `new Date().toISOString()`).

## Invariants

- `HealthResponseSchema.safeParse(responseBody).success === true` for every successful response.
- `uptime >= 0`.
- `timestamp` is parseable by `new Date(...)` and round-trips through `toISOString()`.
- The endpoint performs no I/O — no DB, cache, or network calls — and therefore cannot fail for reasons other than process death (in which case the TCP connection closes before a 5xx can be emitted).

## Verification

| EARS | Test type     | File                               | Notes                                                                                                                                                                            |
| ---- | ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Vitest e2e    | `apps/api/test/health.e2e-spec.ts` | `it('EARS-1: ...')`; uses supertest against booted Fastify app; asserts status 200 + `HealthResponseSchema.parse(body)` + `uptime >= 0` + `Date.parse(timestamp) > 0`.           |
| 1    | Gherkin (e2e) | `scenarios.feature`                | Happy-path scenario; translated to Playwright via `playwright-bdd` once that runner exists (out of scope here — `scenarios.feature` is authored now to satisfy the SDD triplet). |
