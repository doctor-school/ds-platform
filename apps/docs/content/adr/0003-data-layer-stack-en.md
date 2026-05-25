---
title: "ADR-0003 — Data Layer Stack (Primary DB / ORM / Migrations / Policy engine / FTS / Vector / Cache) for DS Platform [EN]"
description: "DS Platform is a standalone platform replacing Bubble + Directual + Supabase. The data layer must support:"
lang: en
---

> **EN (this)** · **RU:** [`0003-data-layer-stack-ru.md`](./0003-data-layer-stack-ru.md)

# ADR-0003 — Data Layer Stack (Primary DB / ORM / Migrations / Policy engine / FTS / Vector / Cache) for DS Platform

**Date:** 2026-05-18 (current revision; full evolution history in `git log`)
**Status:** Accepted
**Related to:** Plane DSO-27 (`bb877d3b-e922-4d8d-8e7b-9b33b4c941ee`), milestone DSO-24, DSO-63 (external validation)
**Design spec:** `apps/docs/content/adr/0003-data-layer-stack-design-en.md`
**Inherits:** ADR-0001 (Identity/Auth/RBAC, hybrid RBAC, IPolicyEngine interface), ADR-0002 (Backend core: NestJS+TS, Zod, REST, BullMQ on Redis, Centrifugo, Timeweb storage/CDN, outbox pattern with consumer-side idempotency), ADR-0009 (PD lifecycle — retention matrix, see forward-refs)

---

## Context

DS Platform is a standalone platform replacing Bubble + Directual + Supabase. The data layer must support:

- ~10–65k existing doctors (migration from Directual) + growth to 1M MAU by v3.
- Append-only ledger with anti-fraud dedup on `event_id`, ~150M records/month by v3.
- Audit log ≥3 years (Federal Law 152-FZ).
- 50M events/day by v3 (analytics — open question, delegated).
- Full-text search across courses/lessons/glossary (Russian language).
- Vector search for AI recommendations and semantic search (v2-v3).
- Cache for sessions, idempotency, rate-limiting, BullMQ, application cache.
- Multi-tenant ready (DS Clinic = client partition; v3).
- 152-FZ — hosting in RF (Russian Federation), doctors' personal data (PD) must not leave the RF zone.
- AI agents — primary development mechanism; the stack must be LLM-friendly.
- Operated by a team of 1–2 people.

ADR-0002 inherits: outbox pattern for cross-system event emit (decouples the data layer from destinations), policy engine — `IPolicyEngine` interface defined in RbacModule with in-memory mock; the concrete engine is selected here.

---

## Decision

### 1. Primary DB: **PostgreSQL 17, self-hosted in Docker on a dedicated data-layer VPS**

- Relational, single-engine, single-node v1.
- Self-hosted (not managed) — extensions without provider negotiations (pgvector, `pg_cron`, logical replication, any custom for DSO-30); 152-FZ — fewer data processors; cost saving 60–180k ₽/year; vendor-neutral.
- Version 17 — improved logical replication (for future ClickHouse fan-out), incremental backups, memory-efficient vacuum, JSON_TABLE, extensions compatibility confirmed.
- Backup: canonical topology (full details in data-layer-design §2.4) — same-provider backup does not provide disaster isolation, so backups span two RF S3 providers + an independent key custody location:

| Layer                        | Location                                                    | Retention                                  | Purpose                           |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| PITR / streaming WAL         | Timeweb Object Storage (primary RF)                         | 7-30d                                      | RPO ≤15min                        |
| Daily full backups           | Timeweb Object Storage                                      | 30d                                        | RTO ≤2h                           |
| **Weekly offsite cold copy** | **Beget S3** (RF, separate provider, separate legal entity) | 90d                                        | provider-level disaster isolation |
| Quarterly archive            | Beget S3                                                    | 1y (or per retention matrix ADR-0009 §2.6) | long-term compliance              |
| **Encryption keys**          | Vault on a dedicated VM (not Timeweb and not Beget)         | —                                          | separation of custody             |
| **Restore drill**            | Quarterly, documented in operational runbook (DSO-10)       | —                                          | RTO validation                    |

Crypto-shred compatibility: per-subject DEK keys (ADR-0009 §5) live in Vault. On an erasure request — DEK zeroization → encrypted PD in backups becomes unreadable immediately. Quarterly KEK rotation destroys old KEKs → 90d offsite retention provides de facto erasure within the 152-FZ SLA (30d).

- RTO/RPO v1: ≤2 hours / ≤15 min.

**Rejected:**

- **MySQL 8 / MariaDB.** Weaker JSON, worse FTS, no pgvector equivalent, Postgres ecosystem broader for AI.
- **CockroachDB / Yugabyte / TiDB (NewSQL distributed).** No managed offering in RF; self-hosting a 3–5 node cluster is unrealistic for a team of 1–2; CockroachDB Inc — US sanctions exposure; distributed performance overhead unwarranted at 200→200k users.
- **MongoDB / document DB.** Append-only ledger requires transactions and joins; the document model would reinvent relational structure.
- **EventStoreDB / event sourcing native.** Niche in RF, AI writes it worse, ops complex; append-only ledger can be implemented on top of Postgres.
- **Managed PostgreSQL on Timeweb.** Hidden cost: pgvector availability must be verified via support; extension allowlist; DPA with Timeweb-as-processor; for v1 SLO 99.0% the reliability premium is overkill. Acceptable as fallback if self-hosting is not feasible.

### 2. Partitioning: **declarative monthly partitioning from v1 for append-only tables**

Partition by month: `ledger`, `audit_log`, `events_log`, `notifications`, `ai_pipeline_jobs`. Not partitioned in v1: `users`, `courses`, `lessons`, `progress` — overhead does not pay off until >10M rows in the table.

**Goal of partitioning from v1** — avoid a retroactive repaint as the system grows: the partition is already in place, retention enforcement if needed = cheap `DROP PARTITION` in O(1).

Managed by the `pg_partman` extension. Premake 2–3 months ahead via BGW. **Drop mask disabled in v1** — we do not know the real growth profile; our platform is not high-load. Enabled when a confirmed retention scenario emerges from observability.

Retention duration **is not fixed in this ADR** — it is a knob, not an architecture (see OQ-D3). Observability-driven approach: alerts on partition sizes; retention numbers are set by a separate product/compliance decision. Floor for `audit_log` ≥3 years (152-FZ) — fixed at the first product review.

### 3. Append-only ledger pattern: **on top of a regular Postgres table, not a separate event-store engine**

- PK = UUID v7.
- `event_id` UNIQUE — anti-fraud dedup at DB level.
- INSERT-only; UPDATE/DELETE prohibited via DB trigger + ORM-layer guard. Corrections are compensating records.
- Integrity hash chain — open question OQ-D8, optional v2+.

### 4. ORM + Migrations: **Drizzle ORM + drizzle-kit**

- TS schema as single source of truth, doc-as-SSOT principle.
- pgvector first-class (`vector(...)` type out of the box).
- Schema files per domain in `packages/db/schema/` — shared SSOT for the whole platform (ADR-0006 §1 SSOT-table + ADR-0008 §2.3), so read-only consumers (`apps/admin`, `apps/cms`, mobile sync) import types without cross-app boundary violations. All PD-bearing tables (`consent_*`, `data_export_requests`, `erasure_requests`, `idempotency_keys`, `job_outbox`, `subject_keys` per ADR-0009 §5) live here. drizzle-kit config in `packages/db/drizzle.config.ts` keeps `out: '../../apps/api/drizzle'` so the migration directory remains `apps/api/drizzle/`.
- drizzle-kit generate → SQL diff files in `apps/api/drizzle/`, human-editable for complex migrations (concurrent index, partition manipulation, RLS).
- In CI — migration dry-run against the staging DB before merge.

**Rejected:**

- **Prisma.** Largest LLM dataset, but Query Engine binary (+30MB image), pgvector behind a preview flag, hides SQL — declarative migration hits edge cases (concurrent index, partitioning, RLS). Loses on our non-CRUD-heavy schema (ledger + audit + events with monthly partitions).
- **TypeORM.** 0.3 in maintenance mode, weak types on relations, AI generates legacy 0.2 patterns that do not work — actively harmful for AI-driven dev.
- **Kysely + Atlas.** Most low-level type-safe SQL + best-in-class declarative migrations, but two tools instead of one, no ORM abstraction (more boilerplate for CRUD), AI knows the combination less well.
- **MikroORM.** Data-mapper pattern, good types, but less popular, higher ops attention required.
- **Raw pg + Atlas.** Maximum control, maximum boilerplate, not viable for a team of 1–2 at scale.

**Expand-contract migrations (pgroll)** — open question OQ-D4, trigger at v2 zero-downtime.

### 5. Policy engine: **Cerbos in embedded mode on v1**

- `@cerbos/embedded` SDK — policies compiled into the bundle at build time → executed in-process in Node, sub-ms latency.
- Policies in `policies/*.yaml` are version-controlled and tested (`cerbos compile --tests` in CI).
- `IPolicyEngine` (from ADR-0002) — thin wrapper, easy to switch to standalone PDP in v2.
- Two-tier guard (symmetric with ADR-0001 JWT validation): ≥99% reads + low-stakes writes — in-process check without Cerbos; high-stakes mutations (payments, AU withdrawal, role-change, admin mutations, PD export) — Cerbos invoked.

**Rejected:**

- **OPA.** General-purpose, Rego syntax more complex than YAML+CEL, AI writes it worse, not specialized for AuthZ.
- **OpenFGA / SpiceDB.** Zanzibar-like ReBAC is overkill for 9 roles × 20–30 objects; would add graph modeling unnecessarily.
- **SQL-based in Postgres.** Authorization checks scattered through code, non-deterministic audit, policy migration = DB migration.
- **Casbin.** Mature, but AI writes it worse than Cerbos YAML, smaller ecosystem in 2025–2026.
- **Custom implementation in TS.** Fine-grained + object-level + multi-role quickly turns into spaghetti.

**Standalone PDP** — open question OQ-D5, trigger at v2 hot-reload without redeploy.

### 6. Full-text search: **PostgreSQL FTS** (Russian stemmer + pg_trgm + GIN indexes)

- `tsvector` GENERATED ALWAYS AS columns with weighting (title=A, description=B, tags=C).
- GIN index on `tsvector`.
- `pg_trgm` GIN index for fuzzy / typo-tolerance.
- Single store instead of a separate search service.

**Rejected for v1:**

- **Meilisearch.** Best-in-class typo-tolerance + instant search + faceting, but: one more service, sync via outbox, data duplication. Not justified at v1 volume (hundreds to thousands of documents).
- **Manticore (Sphinx fork).** Performant, SQL-like, but less mainstream, AI writes it worse, higher ops attention.
- **OpenSearch / Elasticsearch.** 2GB+ JVM, overkill for a team of 1–2 and thousands of documents.

**Trigger to switch to Meilisearch:** UX metric — relevance@5 <60% (manual annotation) or bounce rate on search >40%.

### 7. Vector DB: **pgvector in the main Postgres**, HNSW index

- Drizzle supports `vector('embedding', { dimensions: 1536 })`.
- One DB = one backup, one deploy, transactional guarantee for INSERT row + embedding.
- HNSW in pgvector 0.7+ is fast at our scale.

**Trigger for standalone Qdrant:** vector count >5M or ANN p95 >100ms.

### 8. Cache: **single Redis 7+ instance with an explicit responsibilities matrix**

A single Redis serving cache + sessions + idempotency + rate-limit + queues at once is a multi-purpose SPOF — a Redis outage would break auth, idempotency, and queues simultaneously. Critical data (idempotency keys, critical jobs) must not depend on volatile cache. Responsibilities are therefore split by durability class:

| Concern                                        | Storage                                      | Durability  | Failure behavior                       |
| ---------------------------------------------- | -------------------------------------------- | ----------- | -------------------------------------- |
| Application cache (`cache:`)                   | Redis                                        | volatile    | Re-fetch from Postgres                 |
| Rate limiting (`rl:`)                          | Redis                                        | volatile    | Reset window (acceptable)              |
| OIDC nonces / PKCE (`oidc:`)                   | Redis (TTL ≤5min)                            | volatile    | Re-issue (acceptable)                  |
| JWKS cache (`jwks:`)                           | Redis (TTL 10min)                            | volatile    | Re-fetch (acceptable)                  |
| Introspection cache (`intro:`)                 | Redis (TTL 60s)                              | volatile    | Re-fetch (acceptable)                  |
| **Idempotency keys**                           | **Postgres** (UNIQUE constraint)             | durable     | n/a                                    |
| **Critical jobs**                              | **Postgres outbox** → BullMQ worker          | durable     | Replay from outbox after Redis restart |
| Non-critical jobs (email send, webhook fanout) | BullMQ (Redis) + retry policy                | best-effort | At-least-once retry                    |
| **Session state**                              | **IdP** (per ADR-0001 §6 — not in our Redis) | IdP's DB    | IdP handles                            |

**Schema impact:**

- Table `idempotency_keys (key text PRIMARY KEY, scope text, created_at timestamptz, expires_at timestamptz)` in `packages/db/schema/` — TTL via cron cleanup.
- Table `job_outbox (id uuid PK, kind text, payload jsonb, status text, created_at, claimed_at, completed_at, attempt int)` for critical jobs.
- A BullMQ drainer reads `job_outbox` for critical job kinds; non-critical jobs go directly into BullMQ.
- Queue contract, queue names, idempotency-key policy, critical vs non-critical classification — see `2026-05-18-ds-platform-bullmq-queue-contract-design`.

**Persistence v1:** AOF `appendonly yes appendfsync everysec` + daily RDB → backup to Timeweb Object Storage. Per-namespace eviction policy: `allkeys-lru` for cache namespace, `noeviction` for idempotency/queue namespaces. Health check + alerting are mandatory pre-pilot.

**HA trigger pre-pilot:** Redis Sentinel / managed HA activates IF EITHER `>1000 active users` OR `>1 unplanned restart/month` (we do not wait for v2). Cluster mode — v3 (memory >32GB or throughput >50k ops/s).

### 9. Cluster topology v1 — lifted to ADR-0012

> **Changed 2026-05-18 (DSO-53):** the cluster topology v1 content (api-prod / data-prod / private network / orchestrator choice) is lifted into **ADR-0012 "Deployment Topology v1"** as the canonical artifact. Full inventory, cost envelope, rejected alternatives (K3s / Nomad / Swarm / single-VPS / multi-VPS-LB), preview environments, maintenance window, and staging deferral — all live there.

Data-layer-relevant parameters that ADR-0012 inherits from this ADR (unchanged):

- Postgres + Redis live on an isolated `data-prod` VPS without a public IP.
- api → data communication only via the Timeweb private network.
- Timeweb Object Storage — primary backups (ADR-0003 §2.4), user uploads, AI-pipeline artefacts.

---

## Consequences

### Positive

- Single Postgres + single Redis = simple mental model for AI agents, simple deploy, simple backup.
- pgvector + PG FTS in one DB = transactional guarantees on INSERT row + embedding + search index.
- Drizzle TS schema = SSOT — no divergence between ORM and runtime types; doc-as-SSOT principle satisfied.
- Cerbos embedded = policies-as-code with tests, no separate PDP service on v1.
- Partitioning from v1 → no retroactive repaint needed; retention enforced via cheap `DROP PARTITION`.
- Self-hosted Postgres → unrestricted extensions, full control over tuning, 60–180k ₽/year cheaper than managed.
- Outbox pattern from ADR-0002 already decouples the data layer from destinations — deferred decisions (ClickHouse, Meilisearch, Qdrant) require no rework of emit code.

### Negative

- Self-hosted Postgres ops on us: ~80–100 hours/year (backup verification, upgrades, monitoring, patches).
- Single Postgres node v1 = single point of failure. SLO 99.0% permits this, but requires disciplined backup + restore-drill.
- Cerbos in embedded mode = policy update requires redeploy. Mitigation: policies in a dedicated folder, frequent small redeployments acceptable on v1.
- pgvector + PG FTS share I/O with OLTP. Mitigation: read replica for heavy search/vector queries when the trigger fires.
- Single Redis = SPOF for sessions/idem/rl/bull. Addressed by v2 HA trigger.
- Drizzle is younger than Prisma — smaller ecosystem, risk of missing features. Mitigation: Drizzle's SQL-first nature allows fallback to raw SQL for any edge case without switching ORMs.

### Architectural qualities (metrics, not declarations)

| Quality                | Metric                            | v1             | v3                          |
| ---------------------- | --------------------------------- | -------------- | --------------------------- |
| Availability           | uptime SLO                        | 99.0%          | 99.9%                       |
| RTO                    | After primary DB failure          | ≤2 hours       | ≤1 min                      |
| RPO                    | Data loss window                  | ≤15 min        | ≤30 sec                     |
| Data integrity         | Append-only ledger violation rate | 0 (DB trigger) | 0 + hash-chain daily        |
| Recoverability         | Restore-drill pass rate           | ≥95% weekly    | ≥99% daily                  |
| Search relevance       | Manual annotation @5 on sample    | ≥60%           | ≥85% or Meilisearch trigger |
| Vector ANN latency p95 | pgvector HNSW                     | ≤100ms         | ≤50ms or Qdrant trigger     |
| Cache hit rate         | course detail                     | ≥80%           | ≥95%                        |

---

## Open questions (deferred)

| OQ                                                                  | Review trigger                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-D1. OLAP store (ClickHouse / TimescaleDB) vs read-replica        | Events ≥10M/day or v3 real-time dashboards                                                                                                                                                                                                                                                 |
| OQ-D2. 6.2TB legacy archive — migration/cold storage/proxy strategy | Legal review of author agreements + provider TBD                                                                                                                                                                                                                                           |
| OQ-D3. Retention duration for partitioned tables                    | **CLOSED 2026-05-18 (DSO-63 #6) — retention matrix in ADR-0009 §2.6 + design spec §3** (per entity/table: legal basis, retention period, deletion/anonymization, audit exception, owner). `audit_log` retention 5y (152-FZ + НК РФ + medical) with crypto-shred at term per ADR-0009 §2.4. |
| OQ-D4. Expand-contract migrations (pgroll)                          | v2 zero-downtime requirement                                                                                                                                                                                                                                                               |
| OQ-D5. Cerbos standalone PDP migration                              | v2 hot-reload without redeploy                                                                                                                                                                                                                                                             |
| OQ-D6. Tenant isolation (row-level vs schema-per-tenant)            | First DS Clinic appears (v3)                                                                                                                                                                                                                                                               |
| OQ-D7. Postgres HA (Patroni vs Timeweb managed HA tier)             | v2 99.5% SLO + concurrent ≥10k                                                                                                                                                                                                                                                             |
| OQ-D8. Append-only ledger integrity hash chain                      | Product requires cryptographic immutability (DAO scope DSO-30)                                                                                                                                                                                                                             |

## Delegated

- **OLAP / DWH** — ADR-0004 when OQ-D1 trigger fires.
- **6.2TB legacy archive strategy** — separate task after legal Phase 0.
- **Retention duration** — separate product/compliance decision.
- **Tenant isolation details** — DSO-26 product task or new ADR when the first DS Clinic appears.
- **Right-to-erasure flow + consent management** — **ADR-0009 "PD Lifecycle, Consent, Retention, Erasure"** (2026-05-18, DSO-63 #5+#6) fixes the architecture: consent_versions/acceptances/withdrawals + three erasure levels + per-subject crypto-shred. Implementation — ADR-0009 design spec.
- **DSO-30 (AI runtime)** inherits the pgvector decision; specific embedding models — in DSO-30.
- **Frontend / Mobile** — DSO-28 / DSO-29 can start in parallel.
