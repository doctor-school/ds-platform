---
title: "DS Platform — Backend Core design [EN]"
description: "1. Runtime + language: Node.js 22 LTS + TypeScript 5.6+ strict. Soft constraint from prep — AI agents write TS backend best; types flow end-to-end to..."
lang: en
---

> **EN (this)** · **RU:** [`0002-backend-core-stack-design-ru.md`](./0002-backend-core-stack-design-ru.md)

# DS Platform — Backend Core design

**Date:** 2026-05-13
**Author:** Tech Lead
**Related to:** Plane DSO-26 (`5556d45e-7b62-431e-8d6f-b8beca3386f0`), milestone DSO-24
**Inherits:** ADR-0001 (Identity/Auth/RBAC), spec `0001-identity-provider-shortlist-design-en.md`
**Inputs:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.2/§4/§9.1/§9.4/§9.7, `knowledge-base/documents/ds-platform-components/01-backend.md`, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md`
**Output:** `apps/docs/content/adr/0002-backend-core-stack-en.md` + inputs for DSO-27..31

---

## 0. TL;DR

1. **Runtime + language:** Node.js 22 LTS + TypeScript 5.6+ strict. Soft constraint from prep — AI agents write TS backend best; types flow end-to-end to frontend/mobile; RF hiring of Node developers ≫ Go/Elixir.
2. **Framework:** NestJS 11 with Fastify adapter. Convention-over-configuration disciplines AI generation; ready-made guards/interceptors/pipes for cross-cutting concerns (RBAC, audit, throttle, tenancy) from ADR-0001.
3. **Validation:** Zod via `nestjs-zod` as single source of truth — one Zod schema produces a TS type, runtime validation, and an OpenAPI 3.1 spec.
4. **API style v1:** REST + OpenAPI 3.1. GraphQL rejected at v1 (breaks CDN caching, requires two styles with webhooks); reconsider at v2 with a specific trigger — see §6 OQ2.
5. **SDK:** `openapi-typescript` codegen from OpenAPI → one TS client for Web and Mobile (if mobile = TS), or OpenAPI → native clients via openapi-generator.
6. **Async:** BullMQ via `@nestjs/bullmq` on Redis (Redis already present for sessions/cache); cron via `@nestjs/schedule` + Redis lock.
7. **Realtime:** Centrifugo as a separate Go service (offloads WS load from the main API; ready-made solution for thousands of concurrent webinar viewers).
8. **Object storage + CDN:** Timeweb Object Storage (S3-compat) + Timeweb CDN (fixed at infra level — DSO-10).
9. **API contract guarantees:** path-based versioning (`/v1/...`), cursor-based pagination, RFC 7807 Problem Details for errors, mandatory `Idempotency-Key` for all mutations.
10. **Documentation-as-SSOT:** doc-first cycle (spec → ADR → Module README → code); auto-gen wherever possible (OpenAPI, TypeDoc, Compodoc); CI gates for consistency README↔code, spec↔ADR. See §8.
11. **DB not fixed in DSO-26.** PostgreSQL — working assumption, final choice in DSO-27 with formal candidate comparison (see §6).
12. **Architectural qualities as metrics, not declarations:** scalability factor, stack portability (%), time-to-degradation, RTO, RPO, availability SLO — see §5.

---

## 1. Scope and non-goals

### In scope DSO-26

- Choice of language / runtime / framework / validation / API style / OpenAPI generation.
- Backend architectural pattern (monolith-first, NestJS modules, workers in the same codebase).
- API contract (URL, pagination, error model, idempotency, auth headers).
- Realtime gateway and async queue.
- Performance budget and mandatory speed checklist (§5.2).
- Documentation workflow and docs-as-SSOT principle (§8).
- Architectural qualities and their metrics (§5.6).
- **152-FZ compliance gap from ADR-0001:** consent management subsystem (recording consents + withdrawal per Art. 9 §3) and right-to-erasure flow (Art. 21) — architectural requirements fixed in §5.5; specific modules (`ConsentModule`, `ErasureModule`) added to snapshot §3.1 for v1.
- **ROPA (Registry of Processing Activities) log** — a separate subsystem for logging operations on personal data (PD) (Federal Law 152-FZ requirement), parallel to the audit log (§5.5).
- **Policy engine interface contract** (`IPolicyEngine`) with in-memory/SQL mock implementation — so that guards in DSO-26 are not tied to a specific engine, which is chosen in DSO-27 (§3.2).

### Not in scope DSO-26 (delegated)

- **DB engine and ORM** — DSO-27 (with an explicit candidate list in §6).
- Frontend stack — DSO-28.
- Mobile stack — DSO-29.
- AI runtime (LangGraph etc.) — DSO-30.
- Repo layout (monorepo vs polyrepo) — DSO-31.
- IdP — Zitadel (closed per ADR-0001 §8, DSP-209).
- SMS / email provider with failover scheme, bot-protection — separate tasks.

---

## 2. Language/runtime/framework selection

### 2.1. Why TypeScript on Node.js and not Go / Python / Java / .NET / Ruby

| Stack                | RPS        | Maturity | AI-friendliness | RF hiring | Verdict                                                                                                                |
| -------------------- | ---------- | -------- | --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Node.js + TypeScript | medium     | ★★★      | ★★★             | ★★★       | **Selected**                                                                                                           |
| Java + Spring Boot   | high       | ★★★      | ★★              | ★★★       | Corporate overhead without benefit                                                                                     |
| .NET + ASP.NET Core  | high       | ★★★      | ★★              | ★★        | Microsoft lock-in, RF hiring worsening                                                                                 |
| Ruby on Rails        | low        | ★★★      | ★★              | ★         | Hiring in RF 5-10× more expensive than Node, ecosystem stagnating                                                      |
| Python + FastAPI     | medium-low | ★★★      | ★★★             | ★★★       | No typed end-to-end, GIL; AI service in Python — yes, main API — no                                                    |
| Go (Fiber/Gin)       | high       | ★★★      | ★★              | ★★        | AI writes it worse; types don't flow to TS frontend without codegen; runtime speed not justified when bottleneck is DB |

**Decisive factors:**

- Soft constraint from prep §"Soft constraints": TS/Python preferred over Go/Rust for AI generation.
- 3 prototypes on Next.js + React → frontend is de-facto TS → single language for backend/frontend = end-to-end types without cross-language codegen.
- NMO (Continuing Medical Education), AI, Directual migration, multi-tenant — I/O-bound load, not CPU-bound; Go's runtime advantage doesn't materialize.

### 2.2. Why NestJS and not Hono / Fastify / Express / Koa

| Criterion                             | NestJS                     | Hono   | Fastify | Express    |
| ------------------------------------- | -------------------------- | ------ | ------- | ---------- |
| Ready-made architecture (DI, modules) | ✅                         | ❌     | ❌      | ❌         |
| Declarative RBAC (guards)             | ✅                         | medium | medium  | manual     |
| OpenAPI generation                    | ✅                         | ✅     | ✅      | manual     |
| WebSocket                             | ✅ (but we use Centrifugo) | ✅     | ✅      | plugin     |
| BullMQ integration                    | ✅ `@nestjs/bullmq`        | manual | manual  | manual     |
| Microservices (if needed)             | ✅                         | ❌     | ❌      | ❌         |
| Single-instance RPS                   | 30-50k                     | 80k    | 70k     | 15k        |
| AI agents write patterns              | ★★★                        | ★★     | ★★      | ★★★ legacy |

**Decisive factor:** convention-over-configuration. An AI agent lands on ready-made rails (module → controller → service → guard → interceptor), ensuring code consistency across sessions/models. Hono/Fastify give freedom, but require a developer to keep the architecture in mind.

**Fastify adapter under NestJS** gives +30-50% RPS compared to Express without changing the NestJS API — a practically free upgrade.

### 2.3. Why Zod and not class-validator / TypeBox / Valibot

- **Single source of truth:** Zod schema → TS type (`z.infer<>`) + runtime validation + OpenAPI (via `nestjs-zod-openapi`). No duplication required.
- `class-validator` (classic NestJS) — requires separate DTO classes with decorators; types don't flow from validation to OpenAPI without manual mapping.
- `TypeBox` — JSON Schema-native, lighter but less ergonomic for composition; smaller ecosystem.
- `Valibot` — modern, smaller bundle, but younger (less in LLM dataset → AI writes it worse).

### 2.4. Why REST and not GraphQL / tRPC / gRPC

| Style          | Verdict                   | Reason                                                                                                        |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| REST + OpenAPI | **Selected v1**           | Universal for Web/Mobile/Admin/integrations/webhooks; HTTP cache on CDN for free; AI writes it best           |
| GraphQL        | Deferred v2 (trigger OQ2) | Breaks CDN cache; rate-limit/security harder; webhooks are REST anyway → two styles                           |
| tRPC           | Rejected                  | TS clients only; native mobile (Swift/Kotlin) or Flutter won't work; external integrations — REST             |
| gRPC           | Rejected (for public API) | Browser can't use directly; native mobile — overkill; few RF teams; for service-to-service — may return (OQ4) |

**GraphQL BFF review trigger (OQ2):** if mobile gets ≥3 heavy view endpoints with complex aggregation and measurable benefit (traffic ≥30% or RTT ≥100ms on mobile 3G) — GraphQL is added **on top of** REST as a BFF layer, not instead of it.

---

## 3. Architectural map (pattern, not frozen list)

The NestJS application is divided into modules. **The specific module list is not frozen in DSO-26**, as the functional map may change by the time of development. Below is an illustrative snapshot from PRD v1 as of 2026-05-13.

### 3.1. Domain modules (snapshot, revisable)

| Module                | Endpoint domain            | Phase  | Contents                                                                                                                      |
| --------------------- | -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `AuthModule`          | `/auth/*`                  | v1     | Login, refresh, logout, sessions, MFA. Thin layer over IdP (see ADR-0001)                                                     |
| `UsersModule`         | `/users/*`                 | v1     | Profile, medical status verification, multi-roles. Mirror table from IdP via outbox+reconcile                                 |
| `CoursesModule`       | `/courses/*`, `/lessons/*` | v1     | CRUD courses/lessons, progress, completion events                                                                             |
| `LedgerModule`        | `/ledger/*`                | v1     | Append-only, anti-fraud deduplication by `event_id`, Con/Pul/Au balance                                                       |
| `NotificationsModule` | `/notifications/*`         | v1     | Push/email/SMS queue, templates, retry, failover SMS×2/email×2                                                                |
| `EventsModule`        | `/events/*`                | **v1** | Webinars, in-person events — critical for pilot                                                                               |
| `CertificatesModule`  | `/certificates/*`          | v2     | PDF generation ≤5s                                                                                                            |
| `SubscriptionsModule` | `/subscriptions/*`         | v2     | Donation subscription, `ad_free` flag                                                                                         |
| `AdsModule`           | `/ads/*`                   | v2     | Banner serving with AIPM labeling                                                                                             |
| `ClinicsModule`       | `/clinics/*`               | v3     | DS Clinic, team accruals                                                                                                      |
| `AIPipelineModule`    | `/ai-pipeline/*`           | v3     | Async contract with status polling; thin client to AI runtime (DSO-30)                                                        |
| `IntegrationsModule`  | `/integrations/webhooks/*` | v1     | Incoming webhooks (payments, video hosting, NMO) with signature verification                                                  |
| `AdminModule`         | `/admin/*`                 | v1     | Privileged operations                                                                                                         |
| `AnalyticsModule`     | `/analytics/*`             | v1     | Read-only aggregates                                                                                                          |
| `ConsentModule`       | `/consents/*`              | **v1** | Recording PD processing consents with versioning; withdrawal (Art. 9 §3 Federal Law 152-FZ); user consent export              |
| `ErasureModule`       | `/erasure/*`               | **v1** | Right-to-erasure flow (Art. 21 Federal Law 152-FZ): request, verification, async execution with DAG dependencies, user report |
| `PDNRegistryModule`   | internal                   | **v1** | ROPA log: every operation on PD (read/write/export/erase) logged separately from the audit log, retention 3+ years            |

### 3.2. Cross-cutting modules

| Module                | Type                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RbacModule`          | Global guards + decorators            | Fine-grained + object-level permissions (ADR-0001 §1); guards call the **`IPolicyEngine` interface** (defined in DSO-26 as part of RbacModule), with in-memory/SQL mock implementation. Specific engine (Cerbos / OPA / OpenFGA / SQL) chosen in DSO-27 and plugged in without changing guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AuditModule`         | Two emission paths (see note)         | Append-only audit log 3 years; 23 auth events + domain events. **Auth & security events are emitted explicitly at each command site** (the `AuthAuditLog` port; `auth/session/auth-audit.*`) — their subjects/reasons are heterogeneous (login.success carries sub+method; login.failure a masked identifier+reason and no subject; lockout fires once on the tripping transition; otp.sent a masked identifier and no subject yet), so a generic per-route interceptor cannot build them uniformly. **Uniform-subject resource routes** carry the terminal access row via an `@Authz({ audit })`-driven interceptor, which derives the row from the resolved request subject. Completeness — that no state-changing auth command silently skips its terminal row — is enforced by a CI guard (the high-stakes-route emission-coverage test), not by the interceptor. |
| `TenancyModule`       | Global middleware + AsyncLocalStorage | Multi-tenant context (DS Clinic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ThrottleModule`      | Global guard                          | Rate-limit per-user/IP/ASN; SMS budget circuit breaker (ADR-0001 §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `HealthModule`        | `/healthz`, `/readyz`                 | K8s liveness/readiness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ObservabilityModule` | OpenTelemetry SDK                     | Trace/metric/log → Loki + Tempo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

#### 3.2.1. Mandatory NestJS middlewares (DSO-63 mini-L, 2026-05-18)

> **Forward reference:** the global policy-enforcement guard `AuthzGuard` (an `APP_GUARD` that reads each handler's `@Authz` metadata and fails closed when a handler carries none) and the CI completeness gate `tools/lint-endpoint-authz` are specified in **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`**.

Bootstrap of the NestJS app **must** load the following middlewares in a fixed order (see `apps/api/src/main.ts`):

| Middleware          | Why                                                                                                                                                                                                                                                                  | Config                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fastify/raw-body` | Preserves the raw byte buffer of the request before JSON parsing — mandatory for **webhook signature verification** (Stripe, IdP webhooks, SMS provider callbacks). Without it the signature check is impossible — JSON parsing loses the exact byte representation. | `app.register(fastifyRawBody, { field: 'rawBody', global: false, encoding: 'utf8' })`. Per-route opt-in via `RouteOptions.config.rawBody = true`. |
| `@fastify/helmet`   | Security headers baseline: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy. CSP profile-per-zone (per ADR-0001 §7) — at the nginx level, not in Node (per-zone discrimination needs HTTP routing context). Node helmet — base layer.                  | Default config + HSTS `max-age=31536000; includeSubDomains; preload`.                                                                             |
| `@fastify/compress` | gzip/br compression of response bodies. Reduces egress bandwidth for JSON responses (API responses 5-100KB most of the time).                                                                                                                                        | Default config, `global: true`, threshold 1KB.                                                                                                    |

**NOT loaded here:**

- CSP headers — at the nginx level (zone-specific, see frontend-stack-design §3.2 + ADR-0001 §7).
- TLS termination — at nginx or managed WAF (ADR-0001 §7 + DSO-63 #8 WAF selection).
- Rate limiting — `ThrottleModule` above + edge WAF.

**Verification:** integration test `tests/middleware/baseline.test.ts` checks the presence of security headers + raw-body capture for a test webhook endpoint.

### 3.3. Workers

> **Forward reference:** queue names, payload schemas, retry/DLQ/idempotency policies, and queue-job invariants are specified in **`2026-05-18-ds-platform-bullmq-queue-contract-design`**. The section below covers only worker-process partitioning.

**v1: two worker processes** (pragmatic for a 1-2 person team):

| Worker (v1)            | What it processes                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications-worker` | `push`, `email`, `sms` queues with retry and failover (separate process — critical realtime chain)                                                                                                              |
| `generic-worker`       | All other queues as handlers inside one process: `ledger-events`, `pdf-generate`, `marketing-blast`, `ai-pipeline-result`, `webhooks:*`, `outbox`, cron jobs (reconcile, ledger integrity, leaderboard refresh) |

**v2-v3: split by load**, when metrics show the need:

- `ledger-worker` separate (if ledger becomes a hot path).
- `pdf-worker` separate (CPU-heavy for certificates v2).
- `marketing-worker` separate (batch 10k ≤10 min with throttling v2).
- `outbox-publisher` separate (if throughput requires it).

Split trigger: queue depth p95 > 1000 per hour **or** worker CPU > 70% sustained.

### 3.4. Boundary services (outside main backend)

| Service    | What                       | Why separate                                     |
| ---------- | -------------------------- | ------------------------------------------------ |
| Centrifugo | Realtime WS gateway (Go)   | Offloads realtime load from NestJS               |
| AI runtime | DSO-30 (LangGraph / other) | Isolation of AI calls, PD filter, different SLAs |

### 3.5. Key architectural decisions

1. **Monolith-first.** Logical isolation via modules, not network boundaries. Microservices — only when (a) different SLAs (Centrifugo, AI runtime), (b) different runtime requirements (CPU-heavy PDF worker).
2. **Workers in the same codebase** — one Docker image, different start commands. Shared types.
3. **AI as a thin client.** AIPipelineModule does not know the specific AI stack (LangGraph etc.) — it sees only a REST/queue contract.
4. **Centrifugo outside NestJS** — ready-made solution for thousands of WS connections.
5. **Outbox pattern for all outgoing events** — atomicity of DB transaction + publication.

---

## 4. API contract

### 4.1. URL structure

```
https://api.doctor.school/v1/<domain>/<resource>[/<id>][/<sub-resource>]
```

- Path-based versioning (`/v1/`, not header).
- Plural nouns for resources.
- RPC-style endpoints acceptable for operations (`/auth/login`, `/transactions/:id/reverse`).

### 4.2. Pagination

**Cursor-based default** for all list endpoints with potential growth >1000 items:

```
GET /v1/courses?cursor=eyJpZCI6...&limit=20

Response:
{
  "data": [...],
  "pagination": { "nextCursor": "...", "hasMore": true }
}
```

Offset acceptable only for admin tables with explicit page pagination.

### 4.3. Error model — RFC 7807 Problem Details + extensions

```json
{
  "type": "https://docs.doctor.school/errors/insufficient-balance",
  "title": "Insufficient Au balance",
  "status": 422,
  "detail": "Au balance 50 < required 100",
  "instance": "/v1/ledger/transactions",
  "traceId": "abc123def456",
  "errorCode": "LEDGER_INSUFFICIENT_BALANCE"
}
```

- Stable `errorCode` machine-readable.
- `traceId` = OTel trace ID.
- `detail` is localized, `errorCode` is not.
- No stack traces in prod responses.

### 4.4. Idempotency

All mutating endpoints accept an `Idempotency-Key: <uuid>` header. Backend stores `(key, response)` for 24h in Redis. A repeat request returns the saved response without side effects.

**Required for:** ledger transactions, payments, accruals, SMS/email sending, resource creation.

### 4.5. Authentication

- `Authorization: Bearer <jwt>` header.
- Web: JWT in `HttpOnly + Secure + SameSite=Lax + __Host-` cookie per app (ADR-0001 §6 + §7 — host-only per app, no shared cross-subdomain cookies; cross-app SSO via OIDC silent re-auth).
- Mobile: JWT in Keychain/Keystore, passed in header manually.
- Two-tier validation (ADR-0001 §6): JWT fast-path for ≥99% of requests; `/introspect` for high-stakes (payments, AU withdrawal, role-change, admin mutations, PD export).

### 4.6. CSRF, CORS, rate-limit

- CSRF (Web): double-submit cookie token; (Mobile): not needed.
- CORS: origin allowlist, not `*`.
- Rate-limit: per-user (5 login/15min, 100 API/15min), per-IP (20 login/15min, 1000 API/15min), per-ASN (100 login/h), SMS daily budget circuit breaker ≤2000 (ADR-0001 §7).
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 4.7. OpenAPI and dev tools

- Spec: `/v1/openapi.json`.
- UI: `/v1/docs` (Scalar or Swagger UI); on prod behind admin RBAC, on dev/staging — open.
- SDK: `@ds/api-client` (npm package to private Verdaccio registry) generated in CI via `openapi-typescript`.

### 4.8. Minimal endpoint example

```ts
@Controller({ path: "courses", version: "1" })
export class CoursesController {
  @Get(":id")
  // `@Authz` is the single authoring surface for endpoint authorization.
  // Via `applyDecorators` it desugars into the RbacModule primitives —
  // it sets the authz metadata read by the global `AuthzGuard`, and the
  // matrix generator emits the OpenAPI `x-authz` extension from the same
  // metadata. One annotation, one SSOT. For uniform-subject resource
  // routes like this one, the `audit` class also drives an audit
  // interceptor that appends the terminal access row from the resolved
  // request subject. Auth and security events are NOT recorded this way:
  // they are emitted explicitly at the command site (§3.2 `AuditModule`),
  // because
  // their subjects and reasons are heterogeneous (a login failure has no
  // subject and a masked identifier; a lockout fires once on the tripping
  // transition) and cannot be derived uniformly from a response.
  // Full contract: endpoint-authorization-matrix-design.
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-30"], // covering scenario(s), by EARS id (illustrative)
  })
  @ApiOperation({ summary: "Get course" })
  async getOne(
    @Param("id", new ZodValidationPipe(z.string().uuid())) id: string,
  ): Promise<z.infer<typeof CourseSchema>> {
    return this.coursesService.findOne(id);
  }
}
```

Public (unauthenticated) entry points use `@Public()` + `@Authz({ access: "public", check: "none", … })`: the global `AuthzGuard` skips authentication, but the handler still carries `@Authz` so it appears in the matrix with its audit class. A handler with **no** `@Authz` metadata is denied by the global guard (fail-closed) and fails the `endpoint-authz` CI gate.

---

## 5. Non-functional requirements

### 5.1. Performance budget (from digest §4)

| Metric                  | v1         | v2         | v3         |
| ----------------------- | ---------- | ---------- | ---------- |
| API p50                 | ≤150ms     | ≤120ms     | ≤100ms     |
| API p95                 | **≤500ms** | **≤400ms** | **≤300ms** |
| API p99                 | ≤1500ms    | ≤1000ms    | ≤800ms     |
| Error rate              | <0.5%      | <0.3%      | <0.1%      |
| PDF generation          | ≤5s        | ≤4s        | ≤3s        |
| Marketing blast 10k     | —          | ≤10min     | ≤7min      |
| Webhook ack             | ≤200ms     | ≤150ms     | ≤100ms     |
| WS RTT                  | ≤200ms     | ≤150ms     | ≤100ms     |
| Cold start API instance | ≤5s        | ≤3s        | ≤3s        |
| Availability            | 99.5%      | 99.9%      | 99.95%     |

If p95 is exceeded for 5 consecutive minutes — alert. PR with p95 regression ≥10% on staging — CI fail.

### 5.2. Mandatory speed checklist (PR blockers)

10 points as architectural constraints, not recommendations:

1. **Primary DB under load** (DB choice in DSO-27, working assumption PostgreSQL): for every new/changed SQL query — `EXPLAIN ANALYZE` in PR description. Query >50ms → index or explicit justification. **N+1 queries are prohibited** (linter + query stats snapshot in CI).
2. **Redis cache:** read-heavy endpoints (profile, balance, leaderboard, catalog) — mandatory with cache (cache-aside, TTL ≤5 min or invalidate on event).
3. **CDN with RF edge** (Timeweb CDN) for static and media. No static through NestJS.
4. **Frontend optimization** (DSO-28): SSR/SSG, code-splitting, image-opt, prefetch. NestJS serves only data.
5. **Async mandatory:** any operation >100ms (PDF, email, SMS, AI, marketing, import) — into BullMQ, not in the request lifecycle.
6. **Video provider with RF edge** (DSO-27) + adaptive bitrate.
7. **Realtime gateway separate (Centrifugo)** — API does not hold WS load.
8. **Cursor-pagination** for all list endpoints with potential >1000 items.
9. **Materialized views** for aggregations — **from v2** (at v1 with 10k MAU a regular SELECT+index handles it; premature optimization). Refresh asynchronously via scheduled job.
10. **Load testing:** in **v1 — manual pre-release** (k6 run manually on staging before each release, baseline saved); CI gate on p95 regression ≥10% — **from v2** when staging-mirror infrastructure is available.

### 5.3. CI guards

**v1 (minimal viable set, 4 core gates):**

| Gate                  | Tool                                                                           | What it catches                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Type check            | `tsc --noEmit`                                                                 | Type errors                                                                                                        |
| Lint                  | eslint + `eslint-plugin-no-await-in-loop` + **custom no-class-validator rule** | `await` in loop without `Promise.all`; prohibition of `@ApiProperty` / `class-validator` decorators (enforces zod) |
| Tests                 | Vitest + supertest                                                             | Unit + integration; coverage warning <80%/60%                                                                      |
| OpenAPI spec snapshot | `openapi-diff`                                                                 | Breaking changes without version bump                                                                              |

**Additional gates — moving to v2** (when team grows to 3+ people):

| Gate                                       | Why added                             |
| ------------------------------------------ | ------------------------------------- |
| SQL query review (pg_stat_statements diff) | New slow queries                      |
| Contract tests (Pact / OpenAPI snapshot)   | Contract breakage on integrations     |
| Security scan (`npm audit` + Trivy)        | CVE                                   |
| k6 load-test selective                     | p95 regression                        |
| Docs symbol-existence (ts-morph)           | README ↔ code consistency             |
| TSDoc coverage                             | Public exports without docs           |
| Mermaid C4 render                          | Diagram-as-code validity              |
| Cross-doc consistency                      | Spec ↔ ADR ↔ README not contradicting |

### 5.4. Observability (visible in Grafana from v1)

- RED metrics per endpoint per HTTP method.
- Saturation: Postgres (connections, slow queries, replication lag), Redis (memory, evictions, hit rate), BullMQ (depth, processing rate, fails, DLQ size), Centrifugo (clients, channels, publish rate).
- Business metrics: Au accruals/min, regs/hour, login success rate, payment success rate.

Via OpenTelemetry SDK → Loki + Tempo + Prometheus (engineering-readiness default).

### 5.5. Security baseline (inherited from ADR-0001 §7 + backend-specific)

| Requirement                                           | Implementation                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate-limit per-user/IP/ASN                            | `@nestjs/throttler` + Redis                                                                                                                                                                                                                                                                         |
| SMS budget circuit breaker                            | NotificationsModule                                                                                                                                                                                                                                                                                 |
| CSRF protection                                       | Cookie double-submit                                                                                                                                                                                                                                                                                |
| Input validation                                      | Zod on all endpoints (ZodValidationPipe global)                                                                                                                                                                                                                                                     |
| SQL injection                                         | Only via ORM + parameterized queries (ORM — DSO-27)                                                                                                                                                                                                                                                 |
| XSS protection                                        | JSON-only output, no HTML rendering                                                                                                                                                                                                                                                                 |
| Secrets                                               | `.env` + vault (engineering-readiness)                                                                                                                                                                                                                                                              |
| Audit log 3 years, append-only                        | AuditModule                                                                                                                                                                                                                                                                                         |
| **ROPA log (Federal Law 152-FZ requirement)**         | `PDNRegistryModule` — separate append-only log of PD operations (read/write/export/erase) with UUID, timestamp, actor, target subject, purpose. Not = audit log (audit records action; ROPA records PD processing)                                                                                  |
| **Consent management (Art. 9 §3 Federal Law 152-FZ)** | `ConsentModule` — versioned consents, withdrawal, export                                                                                                                                                                                                                                            |
| **Right-to-erasure (Art. 21 Federal Law 152-FZ)**     | `ErasureModule` — async DAG deletion with verification                                                                                                                                                                                                                                              |
| PD masked in logs                                     | OTel processor + custom redactor                                                                                                                                                                                                                                                                    |
| **npm + Docker registry mirroring**                   | Verdaccio (npm pull-through) + Harbor/Nexus (Docker mirror) — owner DSO-10. **Hard requirement v1**: without mirrors CI breaks on any RF npm/Docker Hub block                                                                                                                                       |
| **Redis HA (sessions + idempotency)**                 | **v1: single-node Redis + AOF + daily RDB snapshot** (ADR-0003 §8). Sessions live in the IdP (ADR-0001 §6), not in Redis. Idempotency keys — in Postgres (ADR-0003 §8). HA trigger (Sentinel ≥3 nodes) — >1000 active concurrent users OR >1 unplanned restart/month (ADR-0003 §8 + ADR-0012 OQ-T2) |
| Helmet secure headers                                 | `@nestjs/helmet`                                                                                                                                                                                                                                                                                    |
| Webhook signature verify                              | IntegrationsModule, per-provider                                                                                                                                                                                                                                                                    |
| TLS termination                                       | At L7 LB (Timeweb / nginx), HSTS preload                                                                                                                                                                                                                                                            |
| Container security                                    | Distroless, non-root, read-only FS                                                                                                                                                                                                                                                                  |

### 5.6. Architectural qualities (metrics, not declarations)

| Quality                             | Metric                                           | v1                                   | v2                 | v3             |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------ | ------------------ | -------------- |
| **Scalability**                     | Horizontal scale-out factor                      | 10× in 1 hour                        | —                  | 100× in 1 hour |
| **Stack portability (low lock-in)** | % of business logic without NestJS dependencies  | ≥60%                                 | —                  | ≥80%           |
| **Reliability under load**          | Time-to-degradation on loss of critical provider | ≥15 min                              | —                  | ≥30 min        |
| **Recovery time**                   | RTO after primary DB failover                    | ≤2 h (manual restore, ADR-0003 §2.4) | ≤5 min (HA)        | ≤1 min         |
| **Data integrity**                  | RPO (data loss window)                           | ≤15 min (WAL gap, ADR-0003 §2.4)     | ≤5 min             | ≤30 sec        |
| **Availability**                    | uptime SLO                                       | 99.0% (ADR-0002 §5.6)                | 99.5% (HA trigger) | 99.95%         |

**Design decisions ensuring these qualities:**

| Quality                | Implementation in design                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalability            | Stateless API, Redis session, connection pooler (PgBouncer/equivalent — DSO-27), read replicas (DSO-27), Centrifugo outside API, BullMQ workers independent                             |
| Stack portability      | REST/OpenAPI (clients don't depend on language), ≥60% of business logic in pure services without decorators, ORM abstraction, BullMQ via interface, Zod schemas portable to JSON Schema |
| Reliability under load | Circuit breakers for external (SMS, email, payment, AI), rate-limit, backpressure via queues, timeout budgets (5s default), graceful shutdown (≤30s), health checks, DLQ, idempotency   |

### 5.7. Reliability scenarios

| Scenario                                    | Protection                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IdP unavailable                             | JWT fast-path continues working ≥15 min; login/refresh — graceful 503 + retry-after; alert                                                                                                                                    |
| Primary DB down                             | Read replica for read-only; writes return 503; failover ≤5 min (v2 multi-AZ)                                                                                                                                                  |
| Redis down (v1 single-node)                 | Cache-bypass (degraded p95, re-fetch from Postgres); BullMQ non-critical jobs pause, critical jobs replay from Postgres outbox (ADR-0003 §8); sessions — unaffected (IdP-side); alert. Recovery from AOF + daily RDB snapshot |
| Redis down (v2+ HA, after Sentinel trigger) | **Redis Sentinel auto-failover** (≤30 sec), sessions — unaffected (IdP-side), cache and BullMQ continue without degradation                                                                                                   |
| SMS provider #1 down                        | Auto-failover to #2                                                                                                                                                                                                           |
| Email provider #1 down                      | Auto-failover to #2                                                                                                                                                                                                           |
| Video provider down                         | Backup provider if available; graceful error; accruals paused                                                                                                                                                                 |
| AI runtime down                             | AI Pipeline jobs queued, retry; UI shows "processing"                                                                                                                                                                         |
| NestJS instance crash                       | LB removes it, K8s/systemd restart; no sticky sessions → seamless                                                                                                                                                             |
| Centrifugo down                             | Realtime updates stop coming; UI fallback to polling 1×/30s                                                                                                                                                                   |

### 5.8. Capacity planning + infra footprint

| Phase        | MAU  | DAU  | Concurrent peak | API RPS peak | Infra footprint (Timeweb VPS)                                                                                                                                                                                                                                                                                                                                      | Est. monthly cost ₽                               | Realistic availability                                               |
| ------------ | ---- | ---- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| v1 (Q1 2027) | 10k  | 1k   | 200             | ~50          | DS Platform prod (see ADR-0012 §Process inventory): api-prod VPS = 1× API + 1× generic-worker + 1× notifications-worker + 1× Centrifugo + 1× nginx; data-prod VPS = 1× Postgres + **1× Redis 7 single-node** (HA trigger per ADR-0003 §8) + 1× pgbackrest sidecar. Shared shared-tooling VPS (DSO-10, separate budget): Verdaccio + Loki/Tempo/Prometheus + Vault. | **~20-30k ₽/month** (see ADR-0012 §Cost envelope) | **99.0% single-AZ** (ADR-0002 §5.6; HA within one DC; cross-AZ — v2) |
| v2 (Q3 2027) | 100k | 10k  | 2k              | ~500         | 2× API + 2× workers (split: ledger + pdf + generic) + 2× Centrifugo + Redis cluster + Postgres primary + 2× read-replica + DWH                                                                                                                                                                                                                                     | ~80-120k ₽/month                                  | 99.5% multi-AZ                                                       |
| v3 (Q1 2028) | 1M   | 100k | 20k             | ~5000        | 5+ API + 4+ workers (full split) + 4× Centrifugo + Redis cluster sharded + Postgres + ClickHouse DWH + full observability infra                                                                                                                                                                                                                                    | ~300-500k ₽/month                                 | 99.95% multi-AZ                                                      |

**v1 availability target:** 99.0% single-AZ (ADR-0002 §5.6); 99.5% moves to v2 once OQ-D7 in ADR-0003 fires (HA Postgres). Maintenance window 02:00–06:00 MSK is excluded from SLO calculation. The full prod-cluster topology is in ADR-0012 "Deployment Topology v1".

k6 load tests — manual pre-release (v1), CI gate from v2 when staging-mirror is available.

**Centrifugo polling fallback overhead in capacity:** when Centrifugo is down, 200 concurrent users × polling 1×/30s = +7 RPS on API. At v1 budget of 50 RPS — 14% overhead, acceptable. At v3 with 20k concurrent — +700 RPS = 14% overhead, also acceptable.

---

## 6. Open questions and deferred decisions

### 6.1. Delegated to other brainstorms

| Question                                           | Where                                                             | Candidates for consideration                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Primary DB                                         | DSO-27                                                            | **PostgreSQL 16** (working assumption) / MySQL 8 / MariaDB / CockroachDB / Yugabyte / TiDB / EventStoreDB / Mongo               |
| ORM                                                | DSO-27                                                            | Prisma / Drizzle / Kysely / TypeORM / MikroORM                                                                                  |
| Migrations                                         | DSO-27                                                            | Prisma migrate / Atlas / Flyway / pgroll                                                                                        |
| Search engine                                      | DSO-27                                                            | Postgres FTS / Manticore / Meilisearch / OpenSearch                                                                             |
| Vector DB                                          | DSO-27 + DSO-30                                                   | pgvector / Qdrant / Weaviate                                                                                                    |
| Cache layout                                       | DSO-27                                                            | Redis (predetermined) + namespace/eviction/TTL strategy                                                                         |
| OLAP vs read-replica                               | DSO-27                                                            | Read-replica OLTP v1-v2 / ClickHouse / DWH v3                                                                                   |
| Policy engine RBAC                                 | DSO-27                                                            | Cerbos / OPA / OpenFGA / SQL-based                                                                                              |
| Frontend stack                                     | DSO-28                                                            | Next.js / Nuxt / SvelteKit / Astro / Remix                                                                                      |
| Web cabinet separation                             | DSO-28                                                            | One SPA with roles vs N applications                                                                                            |
| CMS for promo sites                                | DSO-28                                                            | Next.js / Tilda / Webflow / WordPress                                                                                           |
| Mobile stack                                       | DSO-29                                                            | Native / RN / Flutter / PWA / Capacitor                                                                                         |
| Local-first offline sync                           | DSO-29                                                            | WatermelonDB / SQLite custom / PowerSync                                                                                        |
| AI runtime                                         | DSO-30                                                            | LangGraph / CrewAI / Temporal+LLM / custom                                                                                      |
| LLM cost middleware                                | DSO-30                                                            | Portkey / Bifrost / Helicone                                                                                                    |
| AI providers                                       | DSO-30                                                            | Anthropic / OpenAI / Yandex GPT / Sber GigaChat / Saiga2                                                                        |
| Repo layout                                        | DSO-31                                                            | Turborepo / Nx / pnpm workspaces / polyrepo                                                                                     |
| IdP                                                | Closed per ADR-0001 §8 (DSP-209)                                  | Zitadel                                                                                                                         |
| SMS provider RF + failover                         | Separate task                                                     | SMS.ru / SMSC.ru / Devino — **in RF failover is manual (balancing with different semantics), not Twilio-style auto**            |
| Email provider + failover                          | Separate task                                                     | Mailgun / Postmark / Yandex.Postbox / RF-accessible alternatives                                                                |
| Bot-protection                                     | Separate task                                                     | Yandex SmartCaptcha (default)                                                                                                   |
| **Deployment topology**                            | **Closed 2026-05-18 (DSO-53):** ADR-0012 "Deployment Topology v1" | 2-VPS docker-compose (api-prod + data-prod) + preview-vps; K3s / Nomad / Swarm / single-VPS / multi-VPS-LB rejected             |
| **npm + Docker registry mirroring**                | **DSO-10 (infra-readiness)**                                      | Verdaccio (pull-through proxy) + Harbor/Nexus (Docker mirror). Hard requirement v1                                              |
| **NMO / Roszdravnadzor integration**               | **Separate task (NOT webhook)**                                   | Government system SMEV — XML, GOST signatures, separate module with possible .NET/Java insert via queue. Not a webhook receiver |
| **Sandbox strategy for webhook signature testing** | Separate task                                                     | For payments and video hosting — where to get sandbox keys, how to test on CI                                                   |

### 6.2. Open questions within DSO-26 (may require ADR update)

| OQ                                                    | Review trigger                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ1. Bun as alternative runtime                       | Production support for NestJS on Bun + successful cases in RF                                                                                                        |
| OQ2. GraphQL BFF                                      | v2: ≥3 heavy mobile views with traffic advantage ≥30% or RTT ≥100ms                                                                                                  |
| OQ3. Temporal for durable workflows                   | When long-running flows appear (revenue share approval)                                                                                                              |
| OQ4. gRPC for internal service-to-service             | When monolith splits into ≥3 services with tight coupling                                                                                                            |
| OQ5. Persisted queries / cached responses             | If CDN cache is insufficient                                                                                                                                         |
| OQ6. PDF engine                                       | When implementing CertificatesModule v2 (puppeteer/playwright/LaTeX/typst)                                                                                           |
| OQ7. Test coverage minimums                           | v2 review (starting at 80% unit / 60% integration)                                                                                                                   |
| OQ8. Contract testing tool                            | Pact vs OpenAPI snapshot — at first v1 integration                                                                                                                   |
| **OQ9. AI reverts to class-validator instead of zod** | If eslint no-class-validator rule gives >5 false-positives/week — reconsider approach; alternative — single pre-commit hook converting class-validator → zod via AST |
| **OQ10. Deployment topology choice**                  | **CLOSED 2026-05-18 (DSO-53)** — see ADR-0012 "Deployment Topology v1".                                                                                              |
| **OQ11. v1 availability target — 99.0% or 99.5%**     | **CLOSED 2026-05-18 (DSO-59)** — 99.0% v1 single-AZ per ADR-0002 §5.6; v2 HA trigger via OQ-D7 ADR-0003.                                                             |

### 6.3. Risks and mitigations

| Risk                                      | Mitigation                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| NestJS overkill for team of 1+2           | Start with minimum modules; AI agents compensate for boilerplate          |
| Fastify adapter incompatible with plugins | Check in Phase 0 spike; fallback to Express (-30% RPS)                    |
| Zod-OpenAPI — relatively recent ecosystem | Alternative `@nestjs/swagger` + class-validator kept in reserve           |
| Centrifugo exotic in hiring               | Documentation in Russian, low ops burden, ready-made solution             |
| BullMQ jobs lost on Redis crash           | Redis AOF persistence + outbox source for critical jobs                   |
| Performance budget optimistic             | k6 on staging before v1 release; buffer for optimization                  |
| Documentation diverges from code          | CI gates symbol-existence-check + auto-gen where possible (Principle 8.0) |
| Lock-in on NestJS                         | ≥60% of business logic in pure services without decorators                |

---

## 7. Realtime + Async backbone

### 7.1. Realtime push to client (Centrifugo)

**Architecture:**

```
[Client]  ── WS ──▶  [Centrifugo]  ◀── publish HTTP ── [NestJS API]
                          ▲
                          │ JWT verify (HMAC shared secret)
```

- Client receives a Centrifugo token from NestJS (`POST /v1/realtime/connect-token`), connects to Centrifugo.
- NestJS publishes via Centrifugo HTTP API: `POST /api/publish { channel: "user:<uuid>", data: {...} }`.
- Channels: `user:<uuid>`, `webinar:<id>`, `leaderboard:global`.
- Centrifugo holds 50k+ connections per instance; presence, history, recovery — built-in.

**When WS inside NestJS:** low-frequency low-fanout scenarios (admin live-update, presence in support chat) — acceptable.

### 7.2. Background jobs (BullMQ)

Guarantees:

- At-least-once + retry with exponential backoff (3, 9, 27, 81 sec).
- DLQ after 5 failures → alert in GlitchTip.
- Job idempotency — on the worker side (idempotency_key + Redis SETNX).
- Concurrency limit per worker.

**Why BullMQ and not Temporal:** on Redis (already present), `@nestjs/bullmq` integrated in DI, no 30-day workflows in our scope. Temporal — revisited when long-running flows appear (OQ3).

### 7.3. Webhook ingress

```
1. Verify signature (HMAC / mTLS / IP allowlist — per provider)
   → Invalid: 401, log in audit, no body exposed
2. Quick acknowledge (200 OK) with empty body immediately
3. Enqueue into `webhooks:<provider>` queue
4. Further processing — in worker (retry, idempotency)
```

### 7.4. Outbox pattern for outgoing events

```sql
BEGIN;
  INSERT INTO domain_events (id, type, payload, ...) VALUES (...);
  -- business logic
COMMIT;
```

Separate `outbox-publisher` process (in `generic-worker` for v1):

```
LOOP:
  BEGIN;
  SELECT id, type, payload FROM domain_events
    WHERE published_at IS NULL
    ORDER BY id
    LIMIT 100
    FOR UPDATE SKIP LOCKED;   -- protection against race on parallel instance
  for each:
    publish to Centrifugo / BullMQ / webhook
    UPDATE published_at = now() WHERE id = ...
  COMMIT;
```

Solves the dual-write problem: an event is published if and only if the transaction has been committed.

**Important — at-least-once guarantee:** the outbox-publisher may die after publish but before UPDATE → the event will be resent on the next cycle. Therefore **all consumers must be idempotent by `event_id` (UUID from domain_events.id):**

| Consumer                                | Idempotency mechanism                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ledger-worker`                         | INSERT ledger_transactions with UNIQUE (event_id), ON CONFLICT DO NOTHING                      |
| `notifications-worker` (push/email/SMS) | Redis SET NX `sent:<event_id>:<channel>` TTL 7d before sending                                 |
| Centrifugo publish                      | Centrifugo idempotency via message-id header; client deduplicates based on event_id in payload |
| Webhook outgoing                        | HMAC-signed payload contains event_id; receiver must be idempotent (part of webhook spec)      |
| `marketing-worker`                      | INSERT marketing_blast_recipients with UNIQUE (blast_id, user_id)                              |
| `ai-callback-worker`                    | UNIQUE (event_id) on ai_pipeline_results table                                                 |
| `reconcile-worker` (cron)               | UPSERT pattern; cron jobs are idempotent by definition                                         |

**Prohibition:** no consumer may rely on "outbox-publisher will send exactly once". This is a spec-level contract.

### 7.5. Scheduled jobs

| Task                       | Schedule       | Action                                   |
| -------------------------- | -------------- | ---------------------------------------- |
| Moscow Exchange gold rate  | `0 9 * * *`    | Pull rate                                |
| Reconcile users mirror     | `*/10 * * * *` | Sync with IdP                            |
| Ledger integrity check     | `0 3 * * *`    | Hash-chain validation, alert on mismatch |
| Aggregate leaderboard (v2) | `*/15 * * * *` | Refresh materialized view                |
| Cleanup idempotency keys   | `0 * * * *`    | Redis cleanup                            |
| Streak push trigger (v3)   | `0 19 * * *`   | Push to doctors at risk of streak break  |

Cron runs in a single worker instance via `@nestjs/schedule` + Redis lock.

### 7.6. Flow map (example: lesson completion)

```
User: POST /v1/lessons/:id/complete
   │
   ▼ NestJS Controller (JWT + RBAC + Idempotency-Key check)
   │
   ▼ BEGIN TX
   │    INSERT lesson_progress
   │    INSERT domain_events (type=LessonCompleted)
   │ COMMIT
   │
   ▼ outbox-publisher (<1s)
   ├──▶ BullMQ ledger:events ──▶ ledger-worker
   │                                  │ INSERT ledger_transactions
   │                                  ▼ outbox publish
   │                              Centrifugo: user:<uuid> ──▶ Web/Mobile push
   │
   └──▶ BullMQ notifications:push ──▶ notifications-worker ──▶ FCM/APNs
```

API response — immediately after COMMIT. ~200ms later a "+5 Au" push arrives.

---

## 8. Documentation workflow

### 8.0. Core principle: Docs as SSOT

Documentation is the single source of truth for development, not a by-product. The lens for all of section 8.

1. **Doc-first cycle, not code-first:** brainstorm → spec → ADR → Module README → code. A PR with code but no doc update does not merge.
2. **An AI session starts with docs**, not git history. Module README + ADR — first action.
3. **Docs don't contradict code — by construction:**

- OpenAPI generated from Zod schemas (not written by hand).
- TypeDoc — from TSDoc.
- Compodoc — from NestJS metadata.
- Module README references specific symbols → CI checks existence via AST.

4. **Docs don't contradict each other.** Spec ↔ ADR ↔ README cross-doc consistency — CI gate.
5. **Docs are used operationally.** A section without a reader is deleted. Test: does it answer in 30 sec?
6. **Knowledge base = readable aggregate.** Notion — the same content as in the repo, not an "adapted version".
7. **CI — the only enforcement mechanism.**
8. **Workflow in CLAUDE.md:** after DSO-26 implementation — rule "when working on a module, first read README + ADR".

### 8.1. Documentation layers

**v1 (minimal, for team of 1-2 + AI):**

| Layer              | Where                                    | Who writes              | When                  |
| ------------------ | ---------------------------------------- | ----------------------- | --------------------- |
| Specs (design)     | `docs/superpowers/specs/YYYY-MM-DD-*.md` | Brainstorm → human/AI   | BEFORE code           |
| ADR                | `docs/adr/NNNN-*.md`                     | After brainstorm        | BEFORE code           |
| API docs (OpenAPI) | `/v1/openapi.json` + Scalar UI           | **Auto from Zod**       | Every build           |
| Module READMEs     | `src/<module>/README.md`                 | Developer/AI with code  | In PR (manual review) |
| Runbooks           | `docs/runbooks/<scenario>.md`            | Developer               | On new scenario       |
| Knowledge base     | Fumadocs portal (`apps/docs`)            | Repo is SSOT (ADR-0006) | Merge to main         |

**v2 (when team grows to 3+):**

| Layer                       | Why added                                                                 |
| --------------------------- | ------------------------------------------------------------------------- |
| TSDoc inline + TypeDoc HTML | When public API >50 exports and onboarding new developers becomes regular |
| Compodoc                    | NestJS module graph                                                       |
| C4 Mermaid                  | Architectural diagrams as code                                            |
| Docusaurus site             | Unified documentation portal                                              |

### 8.2. Module README template

```markdown
# <ModuleName>

**Purpose:** one sentence.

## When to read this README

- Before changing the module's public API.
- When first working with the module (new session / new developer).

## Public API

- `POST /v1/courses` — create course [role: admin, expert]
- ...

## Internal services

- `CoursesService.findOne(id)` — with cache (Redis, TTL 5 min)
- ...

## Dependencies

- `UsersModule`, `LedgerModule`, `StorageModule`

## Algorithms and invariants

1. A course is not deleted if >0 lessons completed (soft-delete only).
2. ...

## Events (domain events, via outbox)

- `CourseCreated { id, authorId, ... }`
- ...

## Configuration (env)

- `COURSES_PREVIEW_MAX_SIZE_MB=10`

## Open questions

- Plane DSO-XX
```

### 8.3. Auto-generated artifacts

- **OpenAPI → Scalar UI**: Zod → OpenAPI 3.1 → Scalar UI at `/v1/docs`; HTML snapshot at `https://docs.doctor.school/api/v1/`.
- **TypeDoc**: TSDoc → static site `https://docs.doctor.school/typedoc/`.
- **Compodoc**: NestJS module graph → SVG; documentation coverage → `https://docs.doctor.school/compodoc/`.
- **Mermaid C4**: System Context / Container / Component diagrams in markdown.

### 8.4. Docs-first workflow

```
1. Brainstorm session (skill /brainstorming)
2. Spec in docs/superpowers/specs/
3. Human approval of spec
4. ADR in docs/adr/ (if architectural decision)
5. Spec + ADR commits to main (separate PR from code)
6. Implementation:
   a. Module README with public API + algorithms
   b. Zod schemas (contract)
   c. TDD: tests by contract
   d. Code with TSDoc
   e. Update C4 if structural changes
7. PR with code → CI:
   - 10 NFR checkpoints (§5.2)
   - Docs: README updated, OpenAPI valid, TSDoc coverage not dropped
   - Contract tests
8. Merge → CI publishes:
   - `@ds/api-client` new version
   - Updated Scalar UI / TypeDoc / Compodoc
   - Sync specs + ADR + Module READMEs to Notion
```

### 8.5. CI documentation gates

**v1 (4 core, PR blockers):**

| Gate                   | What it checks                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| openapi-snapshot       | Breaking changes require version bump                                                                                                |
| module-readme-required | PR touches `src/<module>/*.controller.ts`/`*.service.ts` → README in diff (or override label) — **manual review, not machine check** |
| adr-link-check         | Markdown links in specs/ADR are valid                                                                                                |
| spec-frontmatter       | Valid frontmatter (date, status, related-issues)                                                                                     |

**v2 (when team grows to 3+):**

| Gate                                  | When added                                   |
| ------------------------------------- | -------------------------------------------- |
| symbol-existence-check (ts-morph AST) | README growth: when >20 modules with READMEs |
| tsdoc-coverage                        | After adding TypeDoc layer                   |
| c4-diagram-render                     | After adding C4 Mermaid                      |
| cross-doc-consistency                 | After ADR corpus grows to 15+                |

### 8.6. Knowledge base

Documentation SSOT and publishing are defined in ADR-0006 (Documentation & SSOT): the repository is the single source of truth, rendered by the Fumadocs portal (`apps/docs`). No external knowledge-base sync.

### 8.7. Tooling

**Exact npm package names (fixed to avoid confusion):**

- **`nestjs-zod`** (https://github.com/risenforces/nestjs-zod) — the main library for Zod integration in NestJS. Includes `ZodValidationPipe`, `ZodValidationException`, `createZodDto`, and integration with `@nestjs/swagger` for OpenAPI generation.
- NOT `nestjs-zod-openapi` (a different, less common package — not used).
- NOT `@anatine/zod-nestjs` (different niche, for standalone Zod without NestJS wrapper).

**v1 tooling:**

| Tool                             | What                                         |
| -------------------------------- | -------------------------------------------- |
| `nestjs-zod` + `@nestjs/swagger` | OpenAPI 3.1 from Zod schemas                 |
| Scalar API Reference             | API browser (modern, better than Swagger UI) |
| `openapi-typescript`             | SDK generation for clients                   |
| `markdown-link-check`            | CI link checking                             |
| GitHub Action + Notion API       | Sync to knowledge base                       |

**v2 tooling (added as team grows):**

| Tool                  | When                           |
| --------------------- | ------------------------------ |
| TypeDoc               | After TSDoc coverage grows     |
| Compodoc              | NestJS graph as modules grow   |
| Mermaid + C4 plantuml | Architectural diagrams as code |
| Docusaurus            | Unified portal                 |
| `ts-morph`            | AST symbol-existence checks    |

All open-source, self-hosted-friendly.

---

## 9. Decisions summary

| Decision             | Choice                                              |
| -------------------- | --------------------------------------------------- |
| Runtime              | Node.js 22 LTS                                      |
| Language             | TypeScript 5.6+ strict                              |
| Framework            | NestJS 11 + Fastify adapter                         |
| Validation           | Zod via `nestjs-zod` (single source of truth)       |
| API style v1         | REST + OpenAPI 3.1                                  |
| SDK                  | `openapi-typescript` codegen                        |
| Async queue          | BullMQ + `@nestjs/bullmq`                           |
| Scheduled jobs       | `@nestjs/schedule` + Redis lock                     |
| Realtime gateway     | Centrifugo (external Go service)                    |
| Object storage + CDN | Timeweb Object Storage + Timeweb CDN                |
| Pagination           | Cursor-based default                                |
| Error model          | RFC 7807 Problem Details + `errorCode`/`traceId`    |
| Idempotency          | `Idempotency-Key` required for mutations, 24h Redis |
| URL versioning       | Path-based `/v1/...`                                |
| Auth                 | Bearer JWT, two-tier validation (ADR-0001)          |
| Testing              | Vitest + supertest                                  |
| Package manager      | pnpm 9                                              |
| Container            | Distroless, non-root, read-only FS                  |
| Documentation        | Docs-as-SSOT, doc-first, auto-gen, CI gates         |

---

## 10. What DSO-26 unblocks

After adoption of this spec and ADR-0002, the following brainstorms are unblocked:

- **DSO-27** (Data layer) — ORM/migrations/search/cache/policy-engine can now be chosen with the TS stack in mind.
- **DSO-28** (Frontend) — the backend SDK will be `@ds/api-client` (openapi-typescript), frontend can count on a typed fetch client.
- **DSO-29** (Mobile) — cross-platform/native choice with the knowledge that backend REST + OpenAPI works with any client.
- **DSO-30** (AI runtime) — will be a separate service with a REST/queue contract to NestJS, without hard coupling to Node.
- **DSO-31** (Repo layout) — components are now known, monorepo vs polyrepo can be designed.

---

## Appendix A — References

- ADR-0001: `apps/docs/content/adr/0001-identity-provider-shortlist-en.md`
- ADR-0002: `apps/docs/content/adr/0002-backend-core-stack-en.md` (this brainstorm)
- Identity spec: `apps/docs/content/adr/0001-identity-provider-shortlist-design-en.md`
- Tech requirements digest: `outputs/2026-05-12-ds-platform-tech-requirements-digest.md`
- Brainstorm prep: `outputs/2026-05-12-tech-stack-brainstorm-prep.md`
- Engineering readiness: `docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md`
- Infra cost research: `outputs/2026-05-07-infra-cost-research-revised-ai-outside-rf.md`
- AI-agent dev readiness: `outputs/2026-05-12-ai-agent-dev-readiness-research.md`
- PRD v1: `knowledge-base/documents/Doctor-School-Platform-PRD-v1.md`
- Component spec backend: `knowledge-base/documents/ds-platform-components/01-backend.md`
