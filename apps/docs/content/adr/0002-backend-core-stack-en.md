---
title: "ADR-0002 — Backend Core Stack (language / framework / validation / API style) for DS Platform [EN]"
description: "DS Platform is a standalone platform replacing Bubble + Directual + Supabase. The backend core must serve all clients (Web, Mobile, Admin, partner..."
lang: en
---

> **EN (this)** · **RU:** [`0002-backend-core-stack-ru.md`](./0002-backend-core-stack-ru.md)

# ADR-0002 — Backend Core Stack (language / framework / validation / API style) for DS Platform

**Date:** 2026-05-13
**Status:** Accepted
**Related to:** Plane DSO-26 (`5556d45e-7b62-431e-8d6f-b8beca3386f0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0002-backend-core-stack-design-en.md`
**Inherits:** ADR-0001 (Identity/Auth/RBAC)

---

## Context

DS Platform is a standalone platform replacing Bubble + Directual + Supabase. The backend core must serve all clients (Web, Mobile, Admin, partner integrations) and support:

- ~10–65k existing doctors (migration from Directual) + growth to 1M MAU by v3.
- API p95 ≤500ms (v1) → ≤300ms (v3); availability 99.0% (v1) → 99.5% (v2, HA trigger per ADR-0003 OQ-D7) → 99.95% (v3). Fixed by Amendment A1 (2026-05-18, DSO-59).
- Append-only ledger with anti-fraud deduplication by `event_id`, audit log ≥3 years.
- Async tasks (notifications, AI pipeline, PDF, marketing blasts 10k ≤10 min).
- Webhooks for payments, video hosting, AI service, SMS callback.
- Real-time push during live webinars with thousands of viewers.
- Multi-tenant (DS Clinic = client partition).
- Hosting in RF (Russian Federation) (Federal Law 152-FZ).
- AI agents as the primary development mechanism — stack must be LLM-friendly.
- Operated by a team of 1–2 people.

ADR-0001 inherits: hybrid RBAC (fine-grained and object-level — in backend), mirror-users-table from IdP via outbox + reconcile, 23 audit events, two-tier JWT/introspection validation.

---

## Decision

### 1. Runtime + language: **Node.js 22 LTS + TypeScript 5.6+ strict**

- Soft constraint from prep: TS/Python preferred over Go/Rust for AI generation; LLMs write TS backend best.
- 3 prototypes on Next.js + React — frontend is de-facto TS → single language for backend/frontend → types flow end-to-end without cross-language codegen.
- Node 22 LTS until Apr 2027, ESM-only, V8 performance improvements.

**Rejected:**

- **Go (Fiber/Gin/Echo).** Would give ~3× RPS per instance, but: AI writes it worse (less training data), types don't flow to TS frontend without codegen, hiring Go in RF is more expensive. Runtime advantage is not justified for I/O-bound load (bottleneck is DB, not CPU).
- **Python + FastAPI.** A suitable choice for AI runtime (DSO-30), but as the primary API: no typed end-to-end, GIL limitations, separating AI service from main backend becomes harder.
- **Java + Spring Boot.** JVM operations (2-4GB heap, GC) are more resource-intensive for a 1-2 person team; more boilerplate; AI-friendliness lower than NestJS.
- **.NET + ASP.NET Core.** Lock-in to Microsoft ecosystem; RF-sector hiring has worsened since Microsoft's departure.
- **Ruby on Rails.** Lower performance than Node, Ruby hiring in RF dropped 5-10×, ecosystem stagnating.
- **Rust / Elixir.** Exotic in RF hiring market, AI agents write them worse.
- **Bun runtime.** NestJS on Bun is not officially supported in production; not mainstream in RF sector. Open question OQ1 — reconsider when production cases emerge.

### 2. Framework: **NestJS 11 + Fastify adapter**

- Convention-over-configuration disciplines AI generation across sessions/models.
- DI + modular architecture — ready-made rails for cross-cutting concerns (RBAC, audit, throttle, tenancy) from ADR-0001.
- Declarative guards / interceptors / pipes for two-tier JWT/introspection.
- Mature integrations: `@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/throttler`, `@nestjs/swagger`, `@nestjs/helmet`.
- Fastify adapter: +30-50% RPS compared to Express without changing the NestJS API.
- RF hiring of Node/NestJS developers — the most in-demand TS backend on hh.ru/Habr Career.

**Rejected:**

- **Hono.** Lightweight (50MB image, <300ms cold start), end-to-end typing via ts-rest. But: younger (less in LLM dataset), no ready-made architecture (DI, guards, scheduled jobs written by hand), cross-cutting concerns designed from scratch. This is the price for runtime overhead that doesn't materialize under I/O-bound load.
- **Fastify (without NestJS).** Fastest TS framework (70k RPS), but Plugin API is less uniform than NestJS decorators — AI writes less consistently. Fewer ready-made solutions for multi-tenant/RBAC.
- **Express.** Legacy stack, mainstream, but: 30k RPS (worse than NestJS Fastify adapter), no built-in architecture, callback/middleware paradigm is outdated.
- **Koa.** Weaker ecosystem, fewer Russian-language materials, AI agents write it worse.

**NestJS trade-offs (known downsides):** heavy image (~150MB), cold start 1-2s, decorators and DI = more boilerplate. Compensated by AI generation.

### 3. Validation: **Zod via `nestjs-zod` (single source of truth)**

One Zod schema → TS type + runtime validation + OpenAPI 3.1 spec. No duplication.

**Exact package name:** `nestjs-zod` (by risenforces, https://github.com/risenforces/nestjs-zod) — includes `ZodValidationPipe`, `createZodDto`, and integration with `@nestjs/swagger`. NOT `nestjs-zod-openapi` (a different, less common package). NOT `@anatine/zod-nestjs`.

**Protection against AI drift:** a custom eslint rule prohibits `class-validator` decorators and `@ApiProperty` in new code — enforces Zod-only style (LLMs regularly revert to the old `@nestjs/swagger` + class-validator idiom).

**Rejected:**

- **class-validator + class-transformer** (classic NestJS). Requires separate DTO classes with decorators; types don't flow from validation to OpenAPI without manual mapping. Kept as fallback if zod-openapi generation has issues.
- **TypeBox.** JSON Schema-native, lighter, but less ergonomic for composition; smaller ecosystem.
- **Valibot.** Smaller bundle, but younger (less in LLM dataset → AI writes it worse).

### 4. API style v1: **REST + OpenAPI 3.1**

- Universal client: Web, Mobile (any stack), Admin, partner integrations, webhook receivers.
- HTTP caching out of the box on CDN — directly impacts performance.
- Maximum AI generation; webhooks are necessarily REST → one style.
- Simple versioning (path-based `/v1/...`), observability, rate-limit.

**Rejected at v1 (with review conditions):**

- **GraphQL.** Breaks CDN caching (all POST), security is harder (depth-limit, query cost analysis), observability is harder, webhooks are REST anyway. Open question OQ2: reconsider at v2 as a BFF layer on top of REST, trigger — ≥3 heavy mobile views with traffic advantage ≥30% or RTT ≥100ms.
- **tRPC.** TS clients only; native mobile (Swift/Kotlin) or Flutter won't work; external integrations — REST.
- **gRPC.** Browser can't use it directly; native mobile overkill; few RF teams. Open question OQ4: reconsider for internal service-to-service when monolith splits into ≥3 services.

### 5. Client SDK: **`openapi-typescript` codegen → `@ds/api-client` npm package**

OpenAPI spec generated from Zod schemas → CI rebuilds SDK → publishes to private npm registry (Verdaccio in infra). Web and TS mobile get types + fetch client. For native mobile (Swift/Kotlin) — openapi-generator.

### 6. Async backbone: **BullMQ via `@nestjs/bullmq` + `@nestjs/schedule`**

- Redis already present (sessions from ADR-0001 §6, cache).
- `@nestjs/bullmq` integrated into DI with typing.
- Guarantees: at-least-once, retry with backoff, DLQ after 5 failures, job idempotency on the worker side.
- Forward reference: queue contract, names, retry/DLQ policies, idempotency keys — see `2026-05-18-ds-platform-bullmq-queue-contract-design`.

**Rejected:**

- **Temporal.** Durable workflows, but more complex ops + overkill for our scope (no 30-day flows). OQ3: reconsider when long-running flows appear (revenue share approval).
- **RabbitMQ / Kafka.** Separate broker, +infra, +ops. No advantage over Redis+BullMQ.
- **Celery.** Python-only.

### 7. Realtime gateway: **Centrifugo (separate Go service)**

- Ready-made solution for thousands of WS connections (50k+ per instance).
- Offloads realtime load from the main API.
- Presence, history, recovery — built-in.
- Developed by Russian dev (Alexander Emelin); documentation in Russian.

NestJS publishes events via Centrifugo HTTP API; clients subscribe to channels (`user:<uuid>`, `webinar:<id>`, `leaderboard:global`).

WS inside NestJS is acceptable only for low-frequency low-fanout scenarios.

### 8. Object storage + CDN: **Timeweb Object Storage (S3-compat) + Timeweb CDN**

Fixed at infra level (DSO-10). Backend interacts via AWS SDK v3 + thin `StorageService` wrapper. Public URLs — via CDN, not through the backend.

### 9. API contract guarantees

- **Path-based versioning** (`/v1/...`).
- **Cursor-based pagination** default (offset only for admin).
- **RFC 7807 Problem Details** for errors + `errorCode` (stable, machine-readable) + `traceId` (OTel).
- **Idempotency-Key** required for all mutating endpoints, 24h Redis.
- **Authorization: Bearer JWT**; two-tier validation from ADR-0001.

### 10. Documentation-as-SSOT

Doc-first cycle, auto-generation wherever possible, CI gates for consistency README↔code and spec↔ADR. Details — §8 design spec.

**Core principle:** documentation is the single source of truth for development, not a by-product. An AI session starts by reading the Module README + related ADR.

---

## Consequences

### Positive

- AI agents write code consistently across sessions (NestJS convention + auto-gen docs).
- Types flow end-to-end from Zod through OpenAPI into SDK → mismatches between backend and frontend are caught at `tsc`.
- Single language for the main backend → lower cognitive overhead for a 1-2 person team.
- Single Docker image for API + workers → simpler deployment.
- Realtime load offloaded to Centrifugo → API doesn't degrade during webinar peaks.
- Documentation = SSOT → switching between sessions/models doesn't lose context.

### Negative

- NestJS Docker image ~150MB (vs ~50MB Hono) — acceptable for VPS deployment.
- Cold start 1-2s (vs <300ms Hono) — not critical for long-running servers.
- Decorators and DI = 1.5-2× more boilerplate per simple endpoint — compensated by AI generation.
- Two runtimes in the system (Node main + Go Centrifugo + potentially Python AI in DSO-30) — two CI pipelines, requires discipline.
- Lock-in on NestJS decorators — mitigation: ≥60% of business logic in pure services without decorators.
- `nestjs-zod` + OpenAPI generation — mainstream since 2024 (relatively recent). Mitigation: explicit eslint rule, fallback to classic `@nestjs/swagger` + class-validator if issues arise.
- **v1 availability = 99.0% single-AZ** (resolved 2026-05-18, Amendment A1 / DSO-59). 99.5% requires HA Postgres (+15-25k ₽/month) — deferred to v2 per OQ-D7 in ADR-0003 (trigger: pre-pilot → pilot transition). Backup topology / RPO / RTO inherited from ADR-0003 §2.4 + §9. Maintenance window 02:00–06:00 MSK excluded from SLO.
- **Outbox at-least-once** requires idempotency on the side of ALL consumers (details — spec §7.4). Cost: additional code complexity + UNIQUE indexes in DB.

### Architectural qualities (metrics, not declarations)

| Quality                | Metric                                  | v1                                   | v2                 | v3             |
| ---------------------- | --------------------------------------- | ------------------------------------ | ------------------ | -------------- |
| Scalability            | Horizontal scale-out factor             | 10× in 1 hour                        | —                  | 100× in 1 hour |
| Stack portability      | % of business logic without NestJS deps | ≥60%                                 | —                  | ≥80%           |
| Reliability under load | Time-to-degradation on provider loss    | ≥15 min                              | —                  | ≥30 min        |
| Recovery time          | RTO after primary DB failover           | ≤2 h (manual restore, ADR-0003 §2.4) | ≤5 min (HA)        | ≤1 min         |
| Data integrity         | RPO                                     | ≤15 min (WAL gap, ADR-0003 §2.4)     | ≤5 min             | ≤30 sec        |
| Availability           | uptime SLO                              | 99.0%                                | 99.5% (HA trigger) | 99.95%         |

---

## Amendment A1 — v1 availability target resolved (2026-05-18, DSO-59)

**Source:** DSO-59 (`https://plane.bbm.academy/doctor-school/.../DSO-59`). Closes OQ11.

**Context.** The original ADR-0002 (2026-05-13) performance budget declared availability 99.5% v1, while the cons section acknowledged that 99.0% single-AZ without HA Postgres was realistic. OQ11 left the choice open. After DSO-63 external validation, backup topology and RPO/RTO for single-node v1 were fixed in ADR-0003 §2.4 + §9. This amendment synchronises ADR-0002 with already-accepted decisions and formally closes OQ11.

**Decision.**

1. **v1 availability target = 99.0% single-node single-AZ.** No external SLA commitments to partners at decision time (Phase 0 pre-pilot).
2. **Maintenance window:** one weekly window 02:00–06:00 MSK is excluded from SLO calculation. Concrete schedule — operational detail, anchored in DSO-10 readiness checklist, not in the ADR.
3. **RPO / RTO** inherited from ADR-0003 §2.4 (canonical backup topology): RPO ≤15 min (WAL gap), RTO ≤2 h (manual restore by runbook). Quarterly restore drill — part of DSO-10 AC (cross-link to engineering-readiness §4).
4. **Cost envelope:** v1 infra ≤30k ₽/month total. HA Postgres (+15-25k ₽/month) out of scope for v1.
5. **Review trigger:** pre-pilot → pilot transition. At that review, OQ-D7 (Postgres HA — Patroni vs managed) from ADR-0003 is evaluated. Until then — single-node + WAL archiving + multi-provider offsite per ADR-0003 §2.4.

**Locations changed in this ADR.**

- §Context (L18): performance budget line rewritten with three points (v1/v2/v3).
- §Consequences/Negative: availability line rewritten from "trade-off open" to "resolved".
- §Architectural qualities: table extended with a v2 column; Availability / RTO / RPO rows synchronised with ADR-0003.
- §Open questions: OQ11 → CLOSED + cross-ref.

**Cross-references.**

- ADR-0003 §2.4 (canonical backup topology), §9 (architectural qualities v1/v2/v3), OQ-D7 (v2 HA trigger).
- Design spec `2026-05-13-ds-platform-data-layer-design-{ru,en}.md` §2.4 + §9.
- Engineering-readiness spec §4 (quarterly restore drill — operationally anchored on DSO-10).
- ADR-0002 OQ10 (deployment topology) — separate, but now has a fixed SLO target for cost estimate.

**Verification.** After applying the amendment, use grep to confirm that any mention of `99.5%` in `0002-backend-core-stack-{ru,en}.md` either refers to v2 (HA trigger), the v3 context, or the historical explanation of why this amendment exists. Command:

```bash
grep -n "99\." apps/docs/content/adr/0002-backend-core-stack-ru.md apps/docs/content/adr/0002-backend-core-stack-en.md
```

---

## Open questions (deferred)

| OQ                                 | Review trigger                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OQ1. Bun as runtime                | Production support for NestJS on Bun + successful cases in RF                                                                   |
| OQ2. GraphQL BFF                   | v2: ≥3 heavy mobile views with traffic advantage ≥30% or RTT ≥100ms                                                             |
| OQ3. Temporal                      | When long-running flows appear                                                                                                  |
| OQ4. gRPC internal                 | When monolith splits into ≥3 services                                                                                           |
| OQ5. Persisted queries             | If CDN cache is insufficient                                                                                                    |
| OQ6. PDF engine                    | When implementing CertificatesModule v2                                                                                         |
| OQ7. Coverage minimums             | v2 review                                                                                                                       |
| OQ8. Contract testing              | Pact vs OpenAPI snapshot — at first v1 integration                                                                              |
| OQ9. AI reverts to class-validator | eslint no-class-validator rule >5 false-positives/week → reconsider                                                             |
| OQ10. Deployment topology          | **CLOSED 2026-05-18 (DSO-53)** — see ADR-0012 "Deployment Topology v1".                                                         |
| OQ11. v1 availability target       | **CLOSED 2026-05-18 (Amendment A1 / DSO-59)** — 99.0% v1 single-node single-AZ; see ADR-0003 §2.4 + §9 + OQ-D7 (v2 HA trigger). |

## Delegated

- **Primary DB** (DSO-27): PostgreSQL — working assumption; formal comparison with MySQL/CockroachDB/Yugabyte/TiDB.
- **ORM, migrations, search, vector, cache layout, OLAP** — DSO-27.
- **Policy engine RBAC** (Cerbos/OPA/OpenFGA/SQL) — DSO-27. **Interface `IPolicyEngine`** defined in DSO-26 (RbacModule) with in-memory mock; specific engine plugged in without rewriting guards.
- **Frontend stack** — DSO-28.
- **Mobile stack** — DSO-29.
- **AI runtime, LLM middleware, AI providers** — DSO-30.
- **Repo layout** — DSO-31.
- **Final IdP (Authentik vs Zitadel)** — Phase 0 spike.
- **SMS/email providers, bot-protection** — separate tasks (manual failover in RF).
- **Deployment topology** — **closed 2026-05-18 (DSO-53):** see **ADR-0012 "Deployment Topology v1"** (2-VPS docker-compose; K3s / Nomad / Swarm / single-VPS / multi-VPS-LB rejected; preview environments + permanent staging deferred).
- **npm + Docker registry mirroring (Verdaccio + Harbor/Nexus)** — **DSO-10 (infra-readiness)**. Hard requirement v1 — without mirrors CI risks breaking on RF npm/Docker Hub blocks.
- **NMO / Roszdravnadzor integration** — separate task. SMEV + XML + GOST signatures; not a webhook receiver, a separate module possibly with a .NET/Java insert via queue.
- **Sandbox strategy for webhook signature testing** (payments, video hosting) — separate task.
