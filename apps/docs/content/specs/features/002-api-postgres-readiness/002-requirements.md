---
title: "002 — apps/api Postgres wiring + GET /v1/ready"
description: "Requirements: wire apps/api to Postgres via Drizzle, graduate packages/db from stub, ship first migration (pgvector + idempotency_keys), expose GET /v1/ready with Postgres + pgvector probes."
slug: 002-api-postgres-readiness
status: Draft
tracker: https://github.com/doctor-school/ds-platform/milestone/2
parent_issue: https://github.com/doctor-school/ds-platform/issues/29
prior_decisions:
  - ADR-0002 — Backend Core Stack (§3 validation + URI versioning + Vitest)
  - ADR-0003 — Data Layer (§4 Drizzle + drizzle-kit, §5 idempotency_keys, §7 pgvector + HNSW)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS)
  - ADR-0008 — Repo Strategy & Dev Workflow (§2.3 workspace + Turbo task graph)
  - local-dev-environment setup-design 2026-05-18 (§4.1 DATABASE_URL env contract, §9.2 drizzle:migrate snapshot wrapper)
lang: en
---

# 002 — apps/api Postgres wiring + GET /v1/ready (Requirements)

## Outcomes

- `apps/api` gains a real data-layer connection: a `pg.Pool` managed by a `@Global()` `DatabaseModule` and a Drizzle handle exposed via the `DRIZZLE_DB` DI token.
- `packages/db` graduates from stub to first concrete export: `drizzle.config.ts`, `schema/idempotency-keys.ts`, and `createDrizzle(connectionString)` factory.
- The first Drizzle migration (`apps/api/drizzle/0000_initial.sql`) is checked in: `CREATE EXTENSION IF NOT EXISTS vector;` (hand-edited atop drizzle-kit output) + `idempotency_keys` table per ADR-0003 §5.
- A new endpoint `GET /v1/ready` performs two real probes — `SELECT 1` against Postgres and `to_regtype('vector')` for the pgvector extension — and returns a Zod-validated readiness body (HTTP 200 on success, HTTP 503 with a same-shape body on any probe failure).
- The DSP-159 smoke-test probe matrix (dev-stand smoke 2026-05-28…29) has an API-side enabler: the readiness endpoint exercises the same Postgres + pgvector path the dev-stand smoke verifies directly.

## Scope

**In:**

- Bootstrap `packages/db`: `drizzle.config.ts` (`out: '../../apps/api/drizzle'` per ADR-0003 §4), `schema/idempotency-keys.ts`, `src/client.ts` exporting `createDrizzle(connectionString) → { pool, db }`.
- First Drizzle migration `apps/api/drizzle/0000_initial.sql` — `CREATE EXTENSION IF NOT EXISTS vector;` + `idempotency_keys` table.
- New `packages/schemas/readiness/` module: `ReadinessResponseSchema`, `CheckStatusSchema`, types.
- `apps/api/src/database/database.module.ts` — `@Global()` Nest module, `DRIZZLE_POOL` + `DRIZZLE_DB` DI tokens, `pg.Pool` with `statement_timeout`, `onModuleDestroy` closes the pool.
- `apps/api/src/config/env.schema.ts` — Zod-validated `ApiEnvSchema` (`DATABASE_URL` required; `PORT`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS` with defaults; `.passthrough()` so other env vars are not rejected).
- `apps/api/src/readiness/` — `ReadinessModule`, `ReadinessService.check()` (Promise.allSettled over both probes), `ReadinessController` (`@Controller({ path: 'ready', version: '1' })`, throws `HttpException(body, 503)` when aggregate status is `down`), `ReadinessResponseDto = createZodDto(ReadinessResponseSchema)`.
- Migration wrapper in `apps/api/package.json`: `"drizzle:generate"` + `"drizzle:migrate": "pnpm dev:snapshot pre-mig-auto && drizzle-kit migrate --config ../../packages/db/drizzle.config.ts"` (verbatim per setup-design §9.2).
- Tests: Vitest e2e at `apps/api/test/readiness.e2e-spec.ts` (EARS-1 happy, against the real dev-stand DB); Vitest unit at `apps/api/src/readiness/readiness.service.spec.ts` (EARS-2 degraded, mocked pg client); migration smoke via Vitest `globalSetup` at `apps/api/test/setup/migrate.ts` (`spawnSync('pnpm', ['drizzle:migrate'], { stdio: 'inherit', shell: process.platform === 'win32' })`).

**Explicitly out** (each becomes a separate follow-up):

- Domain tables, PD-bearing tables, `job_outbox` (deferred to the feature that first needs each).
- Probes for Redis / MinIO / Centrifugo / Cerbos / Mailpit (added when each is first wired).
- CI job for `apps/api` e2e (same deferral as 001 — `apps/api` is the only api consumer for now).
- Swagger UI / OpenAPI JSON / `@ds/api-client` regeneration.
- helmet, throttler, pino, CORS, RFC 7807 global exception filter.
- pgroll / expand-contract migration tooling (open question OQ-D4 in ADR-0003).

## Constraints

- Node.js 22 LTS, TypeScript strict, ESM-only — per ADR-0002 §1 and root `package.json`.
- URI versioning via `@Controller({ path: 'ready', version: '1' })` — per ADR-0002 §3.
- Validation library `nestjs-zod` + `createZodDto` — per ADR-0002 §3.
- Schema SSOT in `packages/schemas/` (framework-agnostic, depends on `zod` only) — per ADR-0006 §6.2 and ADR-0005 «100% reuse».
- DB schema SSOT in `packages/db/schema/` with `drizzle-kit` `out: '../../apps/api/drizzle'` — per ADR-0003 §4.
- pgvector in the same Postgres as OLTP — per ADR-0003 §7. Confirmed via `to_regtype('vector')` rather than installing the extension at runtime (the migration owns extension creation; runtime only verifies presence).
- `DATABASE_URL` env name and value shape are fixed by the local-dev-environment setup-design §4.1 (`postgres://ds:CHANGE_ME@HOST:5432/ds_dev`).
- `drizzle:migrate` wrapper must chain `pnpm dev:snapshot pre-mig-auto && drizzle-kit migrate …` — verbatim per setup-design §9.2. The chain is a soft guardrail (snapshot failure aborts migrate).
- Test runner Vitest + supertest — per ADR-0002 §3.

## Prior decisions

- **ADR-0002 §3** Backend Core Stack — fixes `nestjs-zod` + `createZodDto`, URI versioning, Vitest + supertest.
- **ADR-0003 §4** Data Layer — Drizzle ORM + drizzle-kit; `packages/db/schema/` SSOT; `out: '../../apps/api/drizzle'`.
- **ADR-0003 §5** Data Layer — `idempotency_keys (key text PRIMARY KEY, scope text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL)` table definition; idempotency stored durably in Postgres, not Redis.
- **ADR-0003 §7** Data Layer — pgvector in the main Postgres with HNSW indexing; `vector(...)` type first-class via Drizzle.
- **ADR-0006 §4** Documentation & SSOT — feature-spec triplet structure (prefixed filenames `NNN-requirements.md` / `NNN-design.md` / `NNN-scenarios.feature`) and flat EARS numbering by default.
- **ADR-0008 §2.3** Repo Strategy & Dev Workflow — workspace layout (`apps/api`, `packages/db`, `packages/schemas`), Turbo task graph.
- **local-dev-environment setup-design** (`apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md`) **§4.1** — `DATABASE_URL` env contract. **§9.2** — `drizzle:migrate` wrapper chains `pnpm dev:snapshot pre-mig-auto`.

## Event Model

This feature exposes a synchronous query handler against a real datastore — still not an aggregate. No commands, no events, no policies — one read model + a degraded variant of it.

| Element       | Name                | Notes                                                                                                                                                                                                 |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read model    | `ReadinessResponse` | `{ status: 'ok' \| 'down', checks: { postgres: 'ok' \| 'down', pgvector: 'ok' \| 'down' }, timestamp: ISO-8601 UTC string }`. Both object levels `.strict()`. `CheckStatusSchema` exported for reuse. |
| Query handler | `GET /v1/ready`     | Runs `SELECT 1` + `SELECT to_regtype('vector') IS NOT NULL` via `Promise.allSettled`. Aggregates into the read model. HTTP 200 if both probes pass; HTTP 503 otherwise (body still conforms).         |

## EARS requirements

> **Numbering convention used here:** flat (EARS-1, EARS-2) per ADR-0006 §4. The feature has a single handler with two genuinely independent shall-clauses — an event-driven happy path and an unwanted-behavior degraded path — which is the idiomatic flat EARS form. Nested `N.M` numbering is not warranted.

- **EARS-1:** When the client sends `GET /v1/ready` and Postgres responds successfully to `SELECT 1` AND `SELECT to_regtype('vector')` returns a non-NULL OID, the system shall respond with HTTP 200 and a JSON body conforming to `ReadinessResponseSchema` with `status='ok'`, `checks.postgres='ok'`, `checks.pgvector='ok'`, and a valid ISO-8601 UTC `timestamp` (`new Date().toISOString()`).
- **EARS-2:** If the client sends `GET /v1/ready` and any probe fails (Postgres unreachable, query times out beyond `DATABASE_STATEMENT_TIMEOUT_MS`, or `to_regtype('vector')` returns NULL), then the system shall respond with HTTP 503 and a JSON body conforming to `ReadinessResponseSchema` with `status='down'`, the failing check set to `'down'`, the succeeding check left at `'ok'`, and a valid ISO-8601 UTC `timestamp`.

## Invariants

- `ReadinessResponseSchema.safeParse(responseBody).success === true` for every response, regardless of HTTP status (200 or 503).
- `status === 'ok'` ⇔ `checks.postgres === 'ok'` AND `checks.pgvector === 'ok'`.
- `status === 'down'` ⇔ at least one of `checks.postgres`, `checks.pgvector` is `'down'`.
- `timestamp` is parseable by `new Date(...)` and round-trips through `toISOString()`.
- The handler never throws an uncaught error to the framework — every failure path is converted into a 503 with a schema-conforming body inside `ReadinessController`.
- `idempotency_keys` table exists in the dev-stand DB after `pnpm drizzle:migrate` (asserted by the migration smoke test, not by EARS).
- pgvector extension is present after `pnpm drizzle:migrate` (asserted indirectly by `to_regtype('vector')` in EARS-1 against the real dev-stand DB).

## Verification

| EARS | Test type     | File                                                    | Notes                                                                                                                                                                                                                                                                                 |
| ---- | ------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Vitest e2e    | `apps/api/test/readiness.e2e-spec.ts`                   | `it('EARS-1: ...')`; uses supertest against booted Fastify app connected to the real dev-stand Postgres; asserts status 200 + `ReadinessResponseSchema.parse(body)` + `body.status==='ok'` + `body.checks.postgres==='ok'` + `body.checks.pgvector==='ok'`.                           |
| 2    | Vitest unit   | `apps/api/src/readiness/readiness.service.spec.ts`      | `it('EARS-2: ...')`; mocks the injected pg client; one case where `query('SELECT 1')` rejects (postgres down), one case where `to_regtype` returns NULL (pgvector missing); asserts the controller emits HTTP 503 with `status='down'`, the failing check `'down'`, the other `'ok'`. |
| —    | Vitest smoke  | `apps/api/test/setup/migrate.ts` (Vitest `globalSetup`) | Runs `pnpm drizzle:migrate` before the e2e suite via `spawnSync('pnpm', ['drizzle:migrate'], { stdio: 'inherit', shell: process.platform === 'win32' })`. Not an EARS — a precondition asserter for the e2e DB.                                                                       |
| 1, 2 | Gherkin (e2e) | `002-scenarios.feature`                                 | One happy scenario for EARS-1, two degraded variants for EARS-2 (postgres unreachable, pgvector missing); translated to Playwright via `playwright-bdd` once that runner exists (out of scope here).                                                                                  |

## Child Issues distribution

The lead agent will open these child Issues after the spec lands. Suggested split:

1. **`feat(db): bootstrap packages/db + initial Drizzle migration`** — kind: `engineering-task` (no EARS handler; pure infra graduation). Scope: `packages/db` from stub, `drizzle.config.ts`, `schema/idempotency-keys.ts`, `src/client.ts`, `apps/api/drizzle/0000_initial.sql`, the `drizzle:migrate` wrapper in `apps/api/package.json`. **Graduates `packages/db` from stub.**
2. **`feat(api): GET /v1/ready with Postgres + pgvector probes`** — kind: `feature-iteration` (closes EARS-1 + EARS-2). Scope: `apps/api/src/database/`, `apps/api/src/config/env.schema.ts`, `apps/api/src/readiness/`, `packages/schemas/readiness/`, all tests.

**Order:** db-bootstrap first. The API child Issue depends on `packages/db` exporting `createDrizzle` and on the migration existing so the e2e DB is in a known state.
