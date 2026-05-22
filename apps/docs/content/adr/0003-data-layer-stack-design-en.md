---
title: "DS Platform — Data Layer design [EN]"
description: "1. Primary DB: PostgreSQL 17, self-hosted in Docker on a dedicated data-layer VPS. pgbackrest daily full + 15-min WAL → Timeweb Object Storage..."
lang: en
---

> **EN (this)** · **RU:** [`0003-data-layer-stack-design-ru.md`](./0003-data-layer-stack-design-ru.md)

# DS Platform — Data Layer design

**Date:** 2026-05-13
**Author:** Tech Lead
**Related to:** Plane DSO-27 (`bb877d3b-e922-4d8d-8e7b-9b33b4c941ee`), milestone DSO-24
**Inherits:** ADR-0001 (Identity/Auth/RBAC, hybrid RBAC, IPolicyEngine interface), ADR-0002 (Backend core: NestJS+TS, Zod, REST, BullMQ on Redis, Centrifugo, Timeweb storage/CDN, outbox pattern with consumer-side idempotency)
**Inputs:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §3/§4/§8.3/§9.1/§9.3/§9.6, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `knowledge-base/documents/ds-platform-components/01-backend.md`
**Output:** `apps/docs/content/adr/0003-data-layer-stack-en.md` + inputs for DSO-28..31

---

## 0. TL;DR

1. **Primary DB:** PostgreSQL 17, self-hosted in Docker on a dedicated data-layer VPS. `pgbackrest` daily full + 15-min WAL → Timeweb Object Storage (offsite RF). Declarative partitioning by month for high-volume tables (`ledger`, `audit_log`, `events_log`) from v1 to avoid a retroactive repaint.
2. **ORM + Migrations:** Drizzle ORM (TS schema = SSOT) + drizzle-kit. pgvector first-class via the `vector(...)` type. Complex migrations (concurrent index, partitioning) — raw SQL inside drizzle-kit-generated files.
3. **Policy engine (RBAC):** Cerbos in embedded mode on v1 (`@cerbos/embedded`). Policies in `policies/*.yaml`, version-controlled, `cerbos compile --tests` in CI. `IPolicyEngine` from ADR-0002 — thin wrapper. Fast-path: in-process fine-grained checks for ≥99% read requests; Cerbos is invoked for high-stakes mutations and admin endpoints.
4. **Full-text search:** PostgreSQL FTS (tsvector + Russian stemmer) + `pg_trgm` for fuzzy + GIN indexes. Single store instead of a separate search service.
5. **Vector DB:** pgvector in the main Postgres, HNSW index. Same DB, same backups, same deploy.
6. **Cache:** single Redis 7+ instance, keyspace namespacing (`session:`, `idem:`, `rl:`, `bull:`, `cache:`, `jwks:`, `intro:`). AOF everysec + RDB hourly. maxmemory 2GB v1, allkeys-lru.
7. **Cluster shape v1:** one data-layer VPS on Timeweb, two Docker containers (Postgres + Redis), a dedicated Docker network, access only from the API VPS via the Timeweb private network.
8. **What is NOT decided and why it is OK for v1:** OLAP store (deferred — outbox pattern from ADR-0002 decouples emit from destination), 6.2TB legacy archive (deferred — depends on legal/author agreements), retention duration (deferred — partitioning already chosen, retention is a knob), expand-contract migrations (deferred — v1 deployments in low-traffic windows), Cerbos standalone PDP (deferred — hot-reload not critical on v1).

---

## 1. Scope and non-goals

### In scope DSO-27

- Primary DB class and concrete engine (Postgres 17).
- Managed vs self-hosted on Timeweb (self-hosted).
- Postgres version (17).
- ORM/query-builder (Drizzle).
- Migration tool (drizzle-kit) + strategy.
- Partitioning schema for high-volume tables.
- Policy engine (Cerbos embedded) + integration with IPolicyEngine from ADR-0002.
- Full-text search engine (PG FTS).
- Vector DB (pgvector).
- Cache layout (single Redis + namespacing).
- Cluster topology v1 (data-layer VPS, Docker, networking).
- Backup + restore strategy (pgbackrest + WAL + Timeweb Object Storage).

### Out of scope DSO-27 (delegated)

- **OLAP store** (ClickHouse / TimescaleDB) — ADR-0004 when trigger fires.
- **6.2TB legacy archive** — separate task after legal review.
- **Retention duration** (2/5/10 years) — separate product/compliance decision.
- **Expand-contract migrations** (pgroll) — separate task when v2 zero-downtime requirement arises.
- **Cerbos standalone PDP migration** — when v2 hot-reload requirement arises.
- **Object storage details** (Timeweb S3-compat) — fixed in ADR-0002 §8.
- **DPO / right-to-erasure flow implementation** — DSO-26 architectural requirement; concrete implementation — separate product task.
- **Tenant isolation (DS Clinic multi-tenant)** — choice between row-level scoping and schema-per-tenant — open question §6 OQ-D6, resolved when the first clinic appears.

---

## 2. Primary DB

### 2.1. DB class

**Decision:** relational, single-engine, single-node v1.

**Candidate comparison:**

| Candidate                            | Verdict     | Reason                                                                                                                                                                                                  |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL 17**                    | ✅ Selected | JSON, FK, FTS, declarative partitioning, pgvector, logical replication, AI-friendly, managed available in RF if needed                                                                                  |
| MySQL 8 / MariaDB                    | Rejected    | Weaker JSON, worse FTS, no pgvector equivalent, Postgres ecosystem broader for AI                                                                                                                       |
| CockroachDB / Yugabyte / TiDB        | Rejected    | No managed offering in RF; self-hosting a distributed cluster is unrealistic for a team of 1–2; CockroachDB Inc — US sanctions exposure; distributed performance overhead unjustified at 200→200k users |
| MongoDB / document DB                | Rejected    | Append-only ledger requires transactions and joins; the document model would reinvent relational structure                                                                                              |
| EventStoreDB / event sourcing native | Rejected    | Niche in RF, AI writes it worse, ops complex. Append-only ledger can be implemented on top of Postgres                                                                                                  |

### 2.2. Managed vs self-hosted

**Decision:** self-hosted PostgreSQL 17 in Docker on a dedicated data-layer VPS on Timeweb.

**Arguments for self-hosted:**

1. The team already self-hosts Plane, Authentik, GlitchTip on Timeweb — Postgres is incremental, not a new discipline.
2. Extensions without provider negotiations (pgvector, `pg_cron`, logical replication, any custom for DSO-30 AI-pipeline). Managed providers typically restrict extensions to an allowlist.
3. 152-FZ — fewer data processors; managed = Timeweb becomes a processor, requiring a separate DPA + audit.
4. Cost: managed Postgres tier with replica on Timeweb 5–15k ₽/month; VPS already paid. At v1 the saved 60–180k ₽/year is real for the startup phase.
5. v1 scale is tiny (200 users); reliability premium of managed (auto-backup, auto-failover) is overkill for a 99.0% SLO.
6. No vendor lock-in: migrating between Timeweb / Selectel / on-prem — `pg_dump | psql` or PITR restore.

**What we give up:**

- Backup discipline is on us (~6–10 hours setup, ~2 hours/quarter maintenance).
- Major version upgrade once a year — 4–8 hours of our time.
- v2 HA requirement (99.5%) is harder — Patroni + etcd 3-node cluster vs managed checkbox.

**Mitigation:**

- pgbackrest config as code in the repo, restore-drill automated weekly.
- Major upgrade — separate planned window once every 1–1.5 years.
- v2 HA — separate ADR (trigger: 99.5% + concurrent ≥10k).

### 2.3. Version

**Decision:** PostgreSQL 17 (pin minor in Docker tag, e.g. `17.4-bookworm`).

**Arguments for 17 (vs 16):**

1. **Logical replication failover** for replication slots and the `pg_createsubscriber` tool — relevant for future ClickHouse fan-out (v2/v3 DWH).
2. **Incremental backups in pg_basebackup** — simplifies backup strategy.
3. **Memory-efficient vacuum** — significant for 150M ledger records/month.
4. **JSON_TABLE + SQL/JSON path** — better for `events_log` queries with JSONB payload.
5. Extension compatibility — pgvector, pgbackrest, pg_cron, pg_partman — all compatible with 17 as of 2026-05.

**Arguments against 18:**

- Released Sep 2025, ~8 months in production as of 2026-05 — early adopter risk for a single team, patch releases still stabilizing. No feature premium.

### 2.4. Backup + restore — canonical topology (DSO-63 #9, single source of truth)

> **Changed 2026-05-18 (DSO-63 #9):** topology expanded to multi-provider offsite + separation of custody. This section is the **single source of truth** for the backup strategy. `engineering-readiness §4` forward-refs here instead of duplicating.

**Decision:** pgbackrest + WAL archiving + **multi-provider offsite (Timeweb primary + Beget S3 offsite)** + Vault-managed encryption keys on a dedicated VM + quarterly restore drill.

**Topology:**

| Layer                          | Location                                                                                    | Retention                                    | Purpose                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| PITR / streaming WAL archiving | Timeweb Object Storage (primary RF, S3-compat)                                              | 7-30d                                        | RPO ≤15min                                               |
| Daily full backups             | Timeweb Object Storage                                                                      | 30d                                          | RTO ≤2h                                                  |
| **Weekly offsite cold copy**   | **Beget S3** (RF, separate provider, separate legal entity — same-provider risk eliminated) | 90d                                          | provider-level disaster isolation                        |
| Quarterly archive              | Beget S3                                                                                    | 1y (or per retention matrix — ADR-0009 §2.6) | long-term compliance                                     |
| **Encryption keys (KEK)**      | Vault on a dedicated VM (not Timeweb, not Beget) — separation of custody                    | rotated quarterly                            | protection against compromise of either storage provider |
| **Per-subject DEK**            | Postgres `subject_keys` table (encrypted by KEK)                                            | until erasure                                | crypto-shred at erasure (ADR-0009 §2.5 + §5)             |

**Why Beget specifically:** RF-located, S3-compatible, separate legal entity (no Timeweb affiliation), already chosen as DNS provider — see [[reference_beget_dns]]. Same-provider backup does not deliver disaster isolation (Timeweb bankruptcy / regulatory block would take both primary and backup).

**Operational parameters:**

- pgbackrest daily full → Timeweb (primary).
- 15-min WAL archiving → Timeweb (primary).
- Weekly `rclone` / `aws s3 sync` job: Timeweb → Beget S3 (incremental).
- Encryption: pgbackrest encrypts backups before upload; KEK fetched via Vault API (network-restricted, only the data VPS has access).
- Per-subject DEK — encrypted-at-rest on every sensitive field (ADR-0009 §5); DEK shred = effective erasure across all backup layers.

**Restore drill — quarterly (operational runbook):**

- Automated cron in staging cluster + smoke test query.
- Restore from each layer (Timeweb daily, Timeweb PITR, Beget weekly).
- Alert in GlitchTip if the drill fails.
- DSO task under DSO-10 (infra readiness) for the runbook write-up.

**Erasure SLA compatibility:** crypto-shred of per-subject key in Vault — immediate. Encrypted PD in backups becomes unreadable **immediately** (live DB + Timeweb primary backup); physical tuple removal — on rotation (≤90d offsite). Compliant with 152-FZ art. 14 (30 days).

**RTO/RPO targets:**

- v1: RTO ≤2 hours (manual restore), RPO ≤15 min (WAL gap).
- v2 (after HA trigger): RTO ≤5 min (Patroni failover or managed HA), RPO ≤5 min.
- v3: RTO ≤1 min, RPO ≤30 sec — requires synchronous replication, separate ADR.

### 2.5. Partitioning

**Decision:** declarative partitioning by month from v1 for high-volume tables.

**Partitioned tables:**

| Table              | Partition by                  | Reason                                                                                                                               |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ledger`           | `RANGE (created_at)`, monthly | Append-only, potential growth to v3; partition pruning speeds up user-history queries; retention enforced via cheap `DROP PARTITION` |
| `audit_log`        | `RANGE (created_at)`, monthly | ADR-0001 §1 audit-log requirement, append-only                                                                                       |
| `events_log`       | `RANGE (created_at)`, monthly | Most volatile stream (presence, view ticks, gameplay events); monthly partition = operationally convenient window                    |
| `notifications`    | `RANGE (created_at)`, monthly | Push/email/SMS queue, append-only                                                                                                    |
| `ai_pipeline_jobs` | `RANGE (created_at)`, monthly | Archived job records + references to artefacts in object storage                                                                     |

**Not partitioned in v1:** `users`, `courses`, `lessons`, `progress` — small, heavily FK-linked, partition overhead does not pay off until >10M rows in the table.

**Partition management:**

- `pg_partman` (as a Postgres extension) — automatic creation of new partitions. On v1 the **drop mask is disabled** — we do not know the real growth profile (our platform is not high-load until v2-v3). Enabled at the first confirmed retention scenario from observability (see below).
- Partition creation — `pg_partman` BGW + premake = 2–3 months ahead.
- `pg_cron` kept for other recurring tasks.

**Retention — closed 2026-05-18 (DSO-63 #6): see ADR-0009 §2.6 + PD-lifecycle design spec §3.**

Retention matrix per entity/table — in `packages/db/schema/pd/retention.ts` (TS object, CI-validated). Every PD-bearing table has: legal basis, retention period, deletion/anonymization, audit exception, owner. Partition retention enforcement (`DROP PARTITION`) follows the retention matrix.

- `audit_log` retention — **5y** (152-FZ + НК РФ + medical compliance), crypto-shred at term (ADR-0009 §2.4).
- `events_log`, `notifications`, `ai_pipeline_jobs` retention — defined in the retention matrix.
- Observability from v1: alerts on the size of each partitioned table (Loki + Grafana from engineering-readiness spec) — kept as a backup safety net.

### 2.6. Extensions

**Enabled in v1:**

- `pgvector` — vector search.
- `pg_trgm` — fuzzy search (LIKE with trigrams).
- `pg_partman` — partition management.
- `pg_cron` — scheduled SQL jobs.
- `pg_stat_statements` — observability (slow queries).
- `pgaudit` — under consideration if ADR-0001 audit requirements cannot be met at the app level.

**Russian FTS dictionary** — built into Postgres (`russian` text search configuration), enabled without additional installation.

### 2.7. Append-only ledger pattern

**Decision:** on top of a regular Postgres table, not a separate event-store engine.

**`ledger` contract:**

- PK = UUID v7 (timestamp-ordered, better for indexes than UUID v4).
- `event_id` UNIQUE — anti-fraud dedup at DB level (idempotent ingest for mobile offline sync — digest §5; see ADR-0005 mobile sync).
- `created_at` NOT NULL, partition key.
- `INSERT`-only. UPDATE and DELETE prohibited via DB trigger + ORM-layer guard. Corrections are compensating records.
- Integrity hash chain (optional v2): each record stores `prev_hash` = hash(prev row); daily cron verifies chain integrity. On v1 — append-only + UNIQUE event_id is sufficient.

**`audit_log` follows the same rules** — same constraints, different columns.

---

## 3. ORM + Migrations

### 3.1. Decision

- **ORM/query-builder:** Drizzle ORM
- **Migration tool:** drizzle-kit

### 3.2. Why Drizzle

| Criterion            | Drizzle                                           | Prisma                                                     | TypeORM                                                |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Partitioning support | ✅ Native (can write `pgTable` with partition-by) | △ Via `migration.sql` raw escape                           | △ Via `@Entity` with limitations                       |
| pgvector             | ✅ First-class `vector(...)` type                 | △ Preview flag + workarounds                               | ❌ None                                                |
| Doc-as-SSOT          | ✅ TS schema = single source                      | △ Separate `.prisma` DSL + codegen to TS                   | △ Decorators inside classes                            |
| Runtime overhead     | ✅ Zero (just SQL builder + drivers)              | ❌ Query Engine binary +30MB                               | ✅ Zero                                                |
| AI-friendly          | △ Minimal API, AI writes it after 2–3 examples    | ✅ Huge dataset, but AI often writes outdated 2.x patterns | ❌ AI often writes 0.2 legacy that doesn't work in 0.3 |
| NestJS integration   | ✅ Native via providers                           | ✅ Via `nestjs-prisma`                                     | ✅ Via `@nestjs/typeorm`                               |
| Maturity             | △ Stable since 2024, active development           | ✅ Mature, 5+ years in production                          | △ In maintenance mode 0.3                              |

**Key point:** our schema is not CRUD-heavy but ledger + audit + events with monthly partitions. Prisma breaks on this via `migration.sql` raw escape — losing the declarative gain. Drizzle's SQL-first approach wins.

### 3.3. Schema organization

- `packages/db/schema/` — TS files per domain (`users.ts`, `courses.ts`, `ledger.ts`, ...). Master location per ADR-0003 Amendment A1 (formerly `apps/api/src/db/schema/` per ADR-0003 §4).
- Each file exports `pgTable` definitions, indexes, foreign keys.
- One `packages/db/schema/index.ts` re-exports everything.
- Drizzle inferred types: `type User = typeof users.$inferSelect`, `type NewUser = typeof users.$inferInsert`.
- Zod schemas for request/response (from ADR-0002) — separate, do not duplicate Drizzle schemas, but generated via `drizzle-zod` where possible.

### 3.4. Migrations workflow

- `drizzle-kit generate:pg` — diff between TS schema and `__drizzle_migrations` meta-table → SQL file in `apps/api/drizzle/`.
- SQL files committed to the repo, human-editable (for concurrent index, partition management, RLS).
- `drizzle-kit migrate` (or `drizzle-orm migrator`) applies in numeric order.
- In CI — migration dry-run against staging DB before merge to `main`.
- Production deployment — migration runs as a separate job step BEFORE API redeploy; rollback strategy — backward-compatible migrations (new columns `NOT NULL DEFAULT` + nullable cleanup in the next release).

### 3.5. Known limitations and mitigation

- **drizzle-kit does not perform expand-contract automatically.** Mitigation v1: deployments in low-traffic windows (200 users — tolerable); destructive migrations manually split into 2 releases (add new column / backfill / drop old).
- **OQ-D4 (open question):** when v2 zero-downtime is required — consider pgroll on top of drizzle-kit for destructive migrations.

---

## 4. Policy engine (RBAC)

### 4.1. Decision

**Cerbos in embedded mode on v1.**

- Embedded SDK: `@cerbos/embedded` for Node.
- Policies compiled into the bundle at build time → executed in-process in Node, sub-ms latency.
- Hot-reload — via redeploy (acceptable on v1).
- Standalone PDP — open question OQ-D5, trigger at v2.

### 4.2. Why Cerbos

| Candidate                   | Suitable | Reason                                                                                                                                               |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cerbos**                  | ✅       | Specialized for AuthZ, YAML+CEL (AI-friendly), decision audit log out of the box, single Go binary, policy test framework, hot-reload, embedded mode |
| OPA                         | Rejected | General-purpose, Rego syntax more complex than YAML, AI writes it worse, not specialized for AuthZ                                                   |
| OpenFGA / SpiceDB           | Rejected | Zanzibar-like ReBAC is overkill for 9 roles × 20–30 objects; would add graph modeling unnecessarily                                                  |
| SQL-based in Postgres       | Rejected | Authorization checks scattered through code, non-deterministic audit, policy migration = DB migration                                                |
| Casbin                      | Rejected | Mature, but AI writes it worse than Cerbos YAML, smaller ecosystem                                                                                   |
| Custom implementation in TS | Rejected | Fine-grained + object-level + multi-role quickly turns into spaghetti                                                                                |

### 4.3. Integration architecture

```
[ NestJS Guard ]
       │
       ▼
[ IPolicyEngine (interface from ADR-0002) ]
       │
       ├── v1: CerbosEmbeddedPolicyEngine (@cerbos/embedded)
       └── v2+: CerbosRemotePolicyEngine (@cerbos/grpc → PDP sidecar)
```

### 4.4. Policies

- **Location:** `policies/*.yaml` in the repo, version-controlled as code.
- **Structure:** one policy per resource (e.g. `policies/course.yaml`, `policies/ledger.yaml`).
- **Tests:** `cerbos compile --tests` runs in CI as a build step; policy test coverage — required CI gate.
- **PR process:** policy change = code review mandatory (at minimum AI-reviewer on v1 + human on high-stakes resources).

### 4.5. Fast-path for read requests

A Cerbos call on every read request adds a few ms latency × ≥99% of requests = poor API p95.

**Two-tier strategy (symmetric with ADR-0001 JWT/introspection two-tier):**

- **Read-paths + low-stakes writes** — `roles[]` from the JWT principal is sufficient for the guard; in-process check without Cerbos.
- **High-stakes mutations** (payments, AU withdrawal, role-change, admin mutations, PD export) — Cerbos is invoked, fine-grained policy + object-level attributes.

Endpoint classification — explicit per-route decorator (`@PolicyCheck('cerbos')` vs default in-process).

---

## 5. Full-text search

### 5.1. Decision

**PostgreSQL FTS** (tsvector + Russian stemmer + GIN indexes) + `pg_trgm` for fuzzy on v1.

### 5.2. Why

- v1 content = courses, lessons, glossary, clinical cases. Volume = hundreds to thousands of documents; v3 = tens of thousands. Postgres FTS handles up to 10M+ documents without issue.
- Russian morphological stemmer is built in (`russian` text search configuration).
- No separate service = no sync overhead, no duplicated backups.
- AI writes SQL FTS excellently.

### 5.3. Schema

```sql
ALTER TABLE courses ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('russian', coalesce(description,'')), 'B') ||
    setweight(to_tsvector('russian', coalesce(tags,'')), 'C')
  ) STORED;

CREATE INDEX courses_search_idx ON courses USING GIN (search_tsv);
```

`pg_trgm` for fuzzy / typo-tolerance — separate GIN index on the field with `trigram_ops`.

### 5.4. Trigger to switch to Meilisearch

UX metric (admin analytics from v1):

- relevance@5 <60% (manual annotation on sample queries), or
- bounce rate on search >40%.

In that case Meilisearch as a separate service, sync via outbox pattern from ADR-0002 (same outbox for other destinations).

---

## 6. Vector DB

### 6.1. Decision

**pgvector in the main Postgres**, HNSW index.

### 6.2. Why

- AI content pipeline (DSO-30) in v2-v3 — embeddings for lesson/course recommendations, semantic search over glossary/cases. Volume: tens of thousands of documents × 1536-dim embedding = up to 100M floats = manageable in Postgres.
- Drizzle supports it natively: `vector('embedding', { dimensions: 1536 })`.
- One DB = one backup, one deploy, one transaction boundary on INSERT row + embedding.
- HNSW index in pgvector 0.7+ is fast.

### 6.3. Alternative and trigger

**Standalone Qdrant** — when:

- vector count >5M (achievable by v3 on current estimates), or
- ANN p95 >100ms (depends on HNSW `m`/`ef_construction` tuning).

In that case — a separate Qdrant instance on the data-layer VPS, sync via outbox.

---

## 7. Cache + Redis responsibilities matrix

> **Changed 2026-05-18 (DSO-63 #10):** explicit responsibilities matrix by durability class. Single Redis is no longer a multi-purpose SPOF — critical concerns (idempotency keys, critical jobs) moved to Postgres. Sessions — to the IdP (ADR-0001 Amendment A2). See ADR-0003 Amendment A2/§A.

### 7.1. Decision

Single Redis 7+ instance for **volatile concerns only**. Durable concerns (idempotency keys, critical jobs, audit log, PD) — in Postgres. Session state — at the IdP, not in our Redis.

### 7.2. Responsibilities matrix (durability classes)

| Concern              | Storage                             | Namespace / Table                            | Durability  | TTL                      | Failure behavior                       |
| -------------------- | ----------------------------------- | -------------------------------------------- | ----------- | ------------------------ | -------------------------------------- |
| Application cache    | Redis                               | `cache:course:<id>`, `cache:lb:global`, etc. | volatile    | 5-15 min                 | Re-fetch from Postgres                 |
| Rate limiting        | Redis                               | `rl:<bucket>:<id>`                           | volatile    | window (15 min / hour)   | Reset window (acceptable)              |
| OIDC nonces / PKCE   | Redis                               | `oidc:<state>`                               | volatile    | ≤5 min                   | Re-issue (acceptable)                  |
| JWKS cache           | Redis                               | `jwks:<kid>`                                 | volatile    | 10 min                   | Re-fetch (acceptable)                  |
| Introspection cache  | Redis                               | `intro:<jti>`                                | volatile    | 60 s                     | Re-fetch (acceptable)                  |
| Non-critical jobs    | Redis (BullMQ)                      | `bull:<queue>:*`                             | best-effort | per-job                  | At-least-once retry policy             |
| **Idempotency keys** | **Postgres**                        | `idempotency_keys` (UNIQUE)                  | **durable** | 24h via cron cleanup     | n/a                                    |
| **Critical jobs**    | **Postgres outbox + BullMQ worker** | `job_outbox` + `bull:critical:*`             | **durable** | retained until completed | Replay from outbox after Redis restart |
| **Session state**    | **IdP** (ADR-0001 Amendment A2)     | IdP's DB                                     | durable     | refresh-token TTL        | IdP handles                            |
| Audit ledger, PD     | Postgres                            | per ADR-0003 §6 + ADR-0009 retention matrix  | durable     | per ADR-0009 §2.6        | n/a                                    |

### 7.3. Config (Redis)

- Redis 7+ (pin patch version in Docker tag).
- `maxmemory: 2GB` v1, scale up by monitoring.
- Per-namespace eviction policy:
- `cache:*` → `allkeys-lru` (cache standard).
- `oidc:*`, `intro:*`, `jwks:*` → `volatile-lru` (TTL-bound).
- `bull:*` → `noeviction` (job loss unacceptable even for non-critical).
- `rl:*` → `allkeys-lru` (reset acceptable).
- **Persistence:** AOF `appendonly yes appendfsync everysec` + RDB daily snapshot.
- **Backup:** Redis RDB snapshot → Timeweb Object Storage daily (rotation 7d).
- **Health check + alerting:** GlitchTip alert on unplanned restarts (counts towards the HA trigger condition).
- TLS — for inter-VPS traffic (if Redis is moved to a separate VPS in v2); v1 co-located with API and Postgres = TLS optional inside Docker network.

### 7.4. Postgres-side schemas

New tables in `packages/db/schema/`:

```ts
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    scope: text("scope").notNull(), // 'http_request', 'webhook', 'job_emit', ...
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    idxExpires: index().on(t.expires_at), // for cron cleanup
  }),
);

export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(), // 'erasure.purge', 'payment.refund', 'nmo.issue_credit', ...
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'claimed' | 'completed' | 'failed'
    attempt: integer("attempt").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    failure_reason: text("failure_reason"),
  },
  (t) => ({
    idxStatus: index().on(t.status, t.created_at),
  }),
);
```

Cron cleanup for `idempotency_keys` (`pg_cron`, hourly): `DELETE WHERE expires_at < NOW()`.

BullMQ drainer worker — a separate process; reads `job_outbox WHERE status = 'pending'`, enqueues into the appropriate BullMQ queue, marks `claimed_at`. On retry — increments `attempt`; max attempts per-kind from config.

> **Forward reference:** the full queue contract — queue names, payload schemas (Zod), retry/backoff/DLQ matrix, per job-kind idempotency keys, queue→worker mapping, critical vs non-critical classification — is specified in **`2026-05-18-ds-platform-bullmq-queue-contract-design`**.

### 7.5. HA trigger (changed, pre-pilot — DSO-63 #10)

Redis Sentinel / managed HA activates IF EITHER:

- (a) `>1000 active users` (concurrent), OR
- (b) `>1 unplanned restart per month` (tracked via GlitchTip alert).

Before that — single-node + AOF + daily RDB backup is acceptable. We do not wait for v2.

Redis Cluster mode — only if memory >32GB or throughput >50k ops/s — a v3 problem.

---

## 8. Cluster topology v1

```
┌─────────────────────────────────────────────────────────┐
│ Timeweb VPS "api-prod"                                  │
│  ├── NestJS API (Docker)                                │
│  ├── BullMQ workers (Docker, same image)                │
│  ├── Centrifugo (Docker)                                │
│  └── Cerbos embedded (in-process in NestJS)             │
└─────────────────────────────────────────────────────────┘
                       │
                       │  Timeweb private network
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Timeweb VPS "data-prod"                                 │
│  ├── PostgreSQL 17 (Docker)                             │
│  │    └── extensions: pgvector, pg_trgm, pg_partman,    │
│  │       pg_cron, pg_stat_statements                    │
│  ├── Redis 7+ (Docker)                                  │
│  └── pgbackrest (Docker cron) → Timeweb Object Storage  │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Timeweb Object Storage (S3-compat)                      │
│  ├── pgbackrest backups (encrypted)                     │
│  ├── User uploads (via ADR-0002 §8)                     │
│  └── AI pipeline artefacts                              │
└─────────────────────────────────────────────────────────┘
```

**Network isolation:**

- Data-VPS has no public IP in production (Timeweb private network only).
- Postgres/Redis bound to private interface.
- Staging environment — separate VPS of the same layout (or one data-VPS with two Docker network namespaces; to be decided separately during v1 cost estimate).

---

## 9. Architectural qualities

| Quality                        | v1                             | v2                            | v3                               |
| ------------------------------ | ------------------------------ | ----------------------------- | -------------------------------- |
| Availability SLO               | 99.0% (single-node)            | 99.5% (HA trigger)            | 99.9% (multi-AZ ADR-?)           |
| RTO                            | ≤2 hours (manual restore)      | ≤5 min (Patroni / managed HA) | ≤1 min (synchronous replication) |
| RPO                            | ≤15 min (WAL gap)              | ≤5 min                        | ≤30 sec                          |
| Backup test cadence            | Weekly automated restore-drill | Daily                         | Continuous                       |
| Migration zero-downtime        | Low-traffic window             | pgroll (trigger)              | Required                         |
| Search latency p95             | ≤200ms (PG FTS)                | ≤100ms                        | ≤50ms                            |
| Vector ANN latency p95         | ≤100ms (pgvector HNSW)         | ≤50ms                         | Qdrant (trigger)                 |
| Cache hit rate (course detail) | ≥80%                           | ≥90%                          | ≥95%                             |

---

## 10. Documentation-as-SSOT

### 10.1. Source-of-truth artefacts

- Drizzle schema TS files — single source for DB structure.
- Cerbos policies `policies/*.yaml` — single source for permissions; auto-doc via `cerbos generate documentation` in CI → published to Module README.
- README in `packages/db/` (per ADR-0003 Amendment A1) explains: schema, partitioning, backup strategy, extensions list, restore runbook. This README is mandatory reading for any AI session beginning work on the data layer.
- ADR-0003 — for cross-cutting decisions; this spec file — for details.

### 10.2. ERD / schema documentation tooling

**Decision:** **Liam ERD** (https://liambx.com) — open-source TypeScript tool, reads Drizzle schema, generates an interactive HTML ERD.

**Why Liam:**

- Open-source (Apache 2.0), self-hostable.
- Natively supports Drizzle schema as input — no intermediate DBML conversion.
- Interactive viewer (panning, table search, deep links) — better than a static image.
- Auto-deploy via CI: on every merge to `main` → generate ERD HTML → publish to internal docs site (or GitHub Pages, or Notion embed).

**Additional tooling:**

- **Mermaid ER diagram** in `packages/db/README.md` (per ADR-0003 Amendment A1) — text-based, human-readable, version-controlled in git, auto-rendered in GitHub/Notion. Generated by a dedicated script from Drizzle schema (or maintained via `drizzle-zero-erd`/community plugin). This is the "text-mode" duplicate for AI agents and code review (Liam HTML is inconvenient to view in a browser during a PR review).
- **SchemaSpy** (optional, post-v1) — Java-based tool, generates HTML docs + statistics **from a live DB** (not from schema files). Useful for verifying "real DB matches the intended schema" and for visualizing index usage / statistics. Runs weekly as a cron job in CI against staging.

**Rejected:**

- **dbdocs.io** / **dbdiagram.io** — cloud-only, RF availability unpredictable, DBML is an intermediate format that duplicates the Drizzle schema.
- **drizzle-kit introspect** alone — only dumps schema to TS, not a human-readable doc.
- **Custom Mermaid generation** — overhead vs Liam.

### 10.3. CI integration

In `.github/workflows/docs.yml` (or equivalent in Gitea Actions):

- On push to `main` → `liam erd build` → HTML artefacts.
- Publish HTML to internal docs host (Timeweb VPS + nginx) or as Notion embed.
- Mermaid auto-update in `packages/db/README.md` (per ADR-0003 Amendment A1) via pre-commit hook (or PR bot that pushes the regenerated Mermaid back into the PR).
- ERD diff blocks merge without code review — guardrail against unintentional schema changes.

---

## 11. Open questions (deferred, by priority)

| OQ                                                                      | Review trigger                                                                                                                                                                                                                                                                                                          | When                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **OQ-D1.** OLAP store (ClickHouse / TimescaleDB) vs read-replica        | Events ≥10M/day or v3 real-time dashboards                                                                                                                                                                                                                                                                              | v2/v3               |
| **OQ-D2.** 6.2TB legacy archive — migration/cold storage/proxy strategy | Legal review of author agreements + provider TBD                                                                                                                                                                                                                                                                        | After legal Phase 0 |
| **OQ-D3.** Retention duration for partitioned tables                    | **CLOSED 2026-05-18 (DSO-63 #6)** — retention matrix in **ADR-0009 §2.6 + PD-lifecycle design spec §3** (per entity/table). `audit_log` retention 5y. `events_log`, `notifications`, `ai_pipeline_jobs` — fixed in the retention matrix. CI gate `lint-retention` validates that any new PD-bearing table has an entry. | —                   |
| **OQ-D4.** Expand-contract migrations (pgroll)                          | v2 zero-downtime requirement (concurrent users ≥5k 24/7)                                                                                                                                                                                                                                                                | v2                  |
| **OQ-D5.** Cerbos standalone PDP migration                              | v2 hot-reload without redeploy                                                                                                                                                                                                                                                                                          | v2                  |
| **OQ-D6.** Tenant isolation (row-level vs schema-per-tenant)            | First DS Clinic appears (v3)                                                                                                                                                                                                                                                                                            | v3                  |
| **OQ-D7.** Postgres HA (Patroni vs Timeweb managed HA tier)             | v2 99.5% SLO + concurrent ≥10k                                                                                                                                                                                                                                                                                          | v2                  |
| **OQ-D8.** Append-only ledger integrity hash chain                      | If product requires cryptographic immutability (DAO scope)                                                                                                                                                                                                                                                              | DSO-30 v2+          |

---

## 12. Consequences

### Positive

- Single Postgres + single Redis = simple mental model for AI agents, simple deploy, simple backup.
- pgvector + PG FTS in one DB = transactional guarantees on INSERT row + embedding + search index.
- Drizzle TS schema = SSOT — no divergence between ORM and runtime types.
- Cerbos embedded = policies-as-code with tests, no separate PDP service on v1.
- Partitioning from v1 → no retroactive repaint needed; retention enforced via cheap `DROP PARTITION`.
- Self-hosted Postgres → unrestricted extensions, full control over tuning, cheaper than managed.

### Negative

- Self-hosted Postgres ops on us: ~80–100 hours/year (backup verification, upgrades, monitoring, patches).
- Single Postgres node v1 = single point of failure. SLO 99.0% permits this, but requires disciplined backup + restore-drill.
- Cerbos in embedded mode = policy update requires redeploy. Mitigation: policies in a dedicated repo/folder, frequent small redeployments acceptable on v1.
- pgvector + PG FTS share I/O with OLTP. Mitigation: read replica for heavy search/vector queries when the trigger fires.
- Single Redis = SPOF for sessions/idem/rl/bull. Addressed by v2 HA trigger.

### Architectural qualities (see §9 for metrics)

| Quality                 | Metric                            | v1             | v3                            |
| ----------------------- | --------------------------------- | -------------- | ----------------------------- |
| Data integrity          | Append-only ledger violation rate | 0 (DB trigger) | 0 + hash-chain verify daily   |
| Recoverability          | Restore-drill pass rate           | ≥95% weekly    | ≥99% daily                    |
| Search relevance        | Manual annotation @5 on sample    | ≥60%           | ≥85% (or Meilisearch trigger) |
| Schema migration safety | Failed migration in prod          | 0 (CI dry-run) | 0 + zero-downtime             |

---

## 13. Next steps

1. Close DSO-27 in Plane with a result comment (artefacts: this spec + ADR-0003).
2. Open dependent tasks: DSO-28 (Frontend), DSO-29 (Mobile) — can start in parallel after DSO-27. DSO-30 (AI/runtime) inherits the pgvector decision from this ADR.
3. Create follow-up tasks in Plane for open questions OQ-D1..OQ-D8 (some tied to v2 milestones, some to product gates).
4. DSO-56 (sandbox webhook) is unblocked.
