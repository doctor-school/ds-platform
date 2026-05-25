---
title: "ADR-0003 — Data Layer Stack (Primary DB / ORM / Migrations / Policy engine / FTS / Vector / Cache) для DS Platform [RU]"
description: "DS Platform — самостоятельная платформа, заменяющая Bubble + Directual + Supabase. Data layer должен обеспечивать:"
lang: ru
---

> **EN:** [`0003-data-layer-stack-en.md`](./0003-data-layer-stack-en.md) · **RU (this)**

# ADR-0003 — Data Layer Stack (Primary DB / ORM / Migrations / Policy engine / FTS / Vector / Cache) для DS Platform

**Дата:** 2026-05-18 (текущая редакция; полная история эволюции — в `git log`)
**Статус:** Accepted
**Связан с:** Plane DSO-27 (`bb877d3b-e922-4d8d-8e7b-9b33b4c941ee`), milestone DSO-24, DSO-63 (внешняя валидация)
**Design spec:** `apps/docs/content/adr/0003-data-layer-stack-design-ru.md`
**Наследует:** ADR-0001 (Identity/Auth/RBAC, hybrid RBAC, IPolicyEngine interface), ADR-0002 (Backend core: NestJS+TS, Zod, REST, BullMQ on Redis, Centrifugo, Timeweb storage/CDN, outbox pattern с consumer-side idempotency), ADR-0009 (PD lifecycle — retention matrix, см. forward-refs)

---

## Context

DS Platform — самостоятельная платформа, заменяющая Bubble + Directual + Supabase. Data layer должен обеспечивать:

- ~10–65k существующих врачей (миграция из Directual) + рост до 1M MAU к v3.
- Append-only ledger с антифрод-дедупом по `event_id`, ~150M записей/мес к v3.
- Audit log ≥3 года (152-ФЗ).
- 50M событий/день к v3 (analytics — open question, делегируется).
- Full-text search по курсам/урокам/глоссарию (русский язык).
- Vector search для AI рекомендаций и semantic search (v2-v3).
- Cache для sessions, idempotency, rate-limit, BullMQ, application cache.
- Multi-tenant ready (DS Clinic = клиент-партиция; v3).
- 152-ФЗ — hosting в RF, ПДн врачей не покидают RF-контур.
- AI-агенты — основной механизм разработки, стек должен быть LLM-friendly.
- Эксплуатация командой 1–2 человек.

ADR-0002 наследует: outbox pattern для cross-system event emit (декаплит data-layer от destinations), policy engine — interface `IPolicyEngine` определён в RbacModule с in-memory mock; конкретный engine выбирается здесь.

---

## Decision

### 1. Primary DB: **PostgreSQL 17, self-hosted в Docker на отдельном data-layer VPS**

- Реляционная, single-engine, single-node v1.
- Self-hosted (не managed) — extensions без провайдер-переговоров (pgvector, `pg_cron`, logical replication, любой кастом для DSO-30); 152-ФЗ — меньше data-processors; cost saving 60-180k ₽/год; vendor-неутрально.
- Версия 17 — лучшая logical replication (для будущего ClickHouse fan-out), incremental backups, vacuum memory-efficient, JSON_TABLE, extensions compatibility подтверждена.
- Backup: каноническая топология (полные детали — data-layer-design §2.4) — same-provider backup не даёт disaster isolation, поэтому backups распределены между двумя RF S3-провайдерами + независимое key-custody:

| Слой                         | Локация                                                       | Retention                                   | Цель                              |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| PITR / streaming WAL         | Timeweb Object Storage (primary RF)                           | 7-30d                                       | RPO ≤15min                        |
| Daily full backups           | Timeweb Object Storage                                        | 30d                                         | RTO ≤2h                           |
| **Weekly offsite cold copy** | **Beget S3** (RF, отдельный provider, отдельный legal entity) | 90d                                         | provider-level disaster isolation |
| Quarterly archive            | Beget S3                                                      | 1y (или per retention matrix ADR-0009 §2.6) | long-term compliance              |
| **Encryption keys**          | Vault на отдельной VM (не Timeweb и не Beget)                 | —                                           | separation of custody             |
| **Restore drill**            | Quarterly, документировано в operational runbook (DSO-10)     | —                                           | RTO validation                    |

Crypto-shred compatibility: per-subject DEK ключи (ADR-0009 §5) хранятся в Vault. При erasure request — zeroization DEK → encrypted PD в backup'ах становится нечитаемым immediately. KEK rotation quarterly уничтожает старые KEKs → 90d offsite retention обеспечивает de facto erasure within 152-ФЗ SLA (30d).

- RTO/RPO v1: ≤2 часа / ≤15 мин.

**Отвергнуто:**

- **MySQL 8 / MariaDB.** Слабее JSON, FTS хуже, нет pgvector-equivalent, экосистема Postgres шире для AI.
- **CockroachDB / Yugabyte / TiDB (NewSQL distributed).** Managed в RF нет; self-host 3-5 node cluster нерeally для team 1-2; CockroachDB Inc — US sanctions exposure; performance overhead distributed для 200→200k users не оправдан.
- **MongoDB / document DB.** Append-only ledger требует транзакций и joins; document-модель переизобретает реляционность.
- **EventStoreDB / event sourcing native.** Экзотика в РФ, AI пишет хуже, ops complex; append-only ledger реализуется поверх Postgres.
- **Managed PostgreSQL на Timeweb.** Hidden cost: pgvector доступность нужно verify через support; extension allowlist; DPA с Timeweb-as-processor; для v1 SLO 99.0% reliability-премия overkill. Fallback при невозможности self-host'а — допустим.

### 2. Partitioning: **declarative monthly partitioning с v1 для append-only таблиц**

Партиционируем by month: `ledger`, `audit_log`, `events_log`, `notifications`, `ai_pipeline_jobs`. Не партиционируем v1: `users`, `courses`, `lessons`, `progress` — overhead не окупается до >10M записей в таблице.

**Цель партиционирования с v1** — избежать retroactive repaint при росте: партиция уже на месте, retention enforcement при необходимости = дешёвый `DROP PARTITION` за O(1).

Управление — `pg_partman` extension. Premake 2-3 месяца вперёд через BGW. **Drop-маска выключена на v1** — мы не знаем реального профиля роста, наша платформа не hiload. Включается при подтверждённом сценарии retention.

Retention duration **не зафиксирован в этом ADR** — это knob, не архитектура (см. OQ-D3). Observability-driven подход: alerts на размер партиций, retention numbers фиксируются отдельным product/compliance решением. Floor для `audit_log` ≥3 года (152-ФЗ) — фиксируется при первом product-review.

### 3. Append-only ledger pattern: **поверх обычной таблицы Postgres, не отдельный event-store engine**

- PK = UUID v7.
- `event_id` UNIQUE — антифрод-дедуп на уровне БД.
- INSERT-only, UPDATE/DELETE запрещены на DB trigger + ORM-layer guard. Корректировки — компенсирующие записи.
- Integrity hash chain — open question OQ-D8, опционально v2+.

### 4. ORM + Migrations: **Drizzle ORM + drizzle-kit**

- TS schema как single source of truth, doc-as-SSOT принцип.
- pgvector first-class (`vector(...)` type из коробки).
- Schema-файлы по доменам в `packages/db/schema/` — общая SSOT для всей платформы (ADR-0006 §1 SSOT-table + ADR-0008 §2.3), так read-only потребители (`apps/admin`, `apps/cms`, mobile sync) импортируют типы без cross-app boundary violation. Все PD-bearing таблицы (`consent_*`, `data_export_requests`, `erasure_requests`, `idempotency_keys`, `job_outbox`, `subject_keys` по ADR-0009 §5) живут здесь. drizzle-kit конфиг в `packages/db/drizzle.config.ts` указывает `out: '../../apps/api/drizzle'` — миграционная директория остаётся `apps/api/drizzle/`.
- drizzle-kit generate → SQL-diff-файлы в `apps/api/drizzle/`, human-editable для сложных миграций (concurrent index, partition manipulation, RLS).
- В CI — migration dry-run против staging БД перед merge.

**Отвергнуто:**

- **Prisma.** Самый большой LLM-датасет, но Query Engine binary (+30MB image), pgvector через preview-flag, прячет SQL — declarative migration упирается в edge cases (concurrent index, partitioning, RLS). На нашей не-CRUD-heavy схеме (ledger + audit + events с месячными партициями) проигрывает.
- **TypeORM.** 0.3 в maintenance-mode, weak types на relations, AI генерит legacy-паттерны 0.2 которые не работают — активно вредит AI-driven dev.
- **Kysely + Atlas.** Самый low-level type-safe SQL + best-in-class declarative migrations, но два инструмента вместо одного, нет ORM-abstraction (больше boilerplate для CRUD), AI хуже знает связку.
- **MikroORM.** Data-mapper pattern, хорошие типы, но меньше hot, ops-attention выше.
- **Raw pg + Atlas.** Max control, max boilerplate, не для team 1-2 на скейл.

**Expand-contract migrations (pgroll)** — open question OQ-D4, триггер v2 zero-downtime.

### 5. Policy engine: **Cerbos в embedded mode на v1**

- `@cerbos/embedded` SDK — политики компилируются в bundle при build → выполняются in-process в Node, sub-ms latency.
- Политики в `policies/*.yaml` версионируются, тестируются (`cerbos compile --tests` в CI).
- `IPolicyEngine` (из ADR-0002) — тонкая обёртка, легко переключается на standalone PDP в v2.
- Two-tier guard (симметрично с ADR-0001 JWT validation): ≥99% read + low-stakes write — in-process check без Cerbos; high-stakes mutations (payments, AU withdrawal, role-change, admin mutations, PII export) — Cerbos invoked.

**Отвергнуто:**

- **OPA.** General-purpose, Rego синтаксис сложнее YAML+CEL, AI пишет хуже, не специализирован под AuthZ.
- **OpenFGA / SpiceDB.** Zanzibar-like ReBAC избыточен для 9 ролей × 20-30 объектов; добавит граф-моделирование без необходимости.
- **SQL-based в Postgres.** Проверки авторизации размазаны по коду, audit недетерминированный, миграция политик = миграция БД.
- **Casbin.** Зрелый, но AI пишет хуже Cerbos YAML, экосистема меньше в 2025-2026.
- **Самописное в TS.** Fine-grained + object-level + multi-role быстро превращается в спагетти.

**Standalone PDP** — open question OQ-D5, триггер v2 hot-reload без redeploy.

### 6. Full-text search: **PostgreSQL FTS** (русский stemmer + pg_trgm + GIN-индексы)

- `tsvector` GENERATED ALWAYS AS колонки со взвешиванием (title=A, description=B, tags=C).
- GIN-индекс на `tsvector`.
- `pg_trgm` GIN-индекс для fuzzy / typo-tolerance.
- Один store вместо отдельного search-сервиса.

**Отвергнуто на v1:**

- **Meilisearch.** Best-in-class typo-tolerance + instant search + faceting, но: ещё один сервис, sync через outbox, дублирование данных. Не оправдан на v1 объёме (сотни-тысячи документов).
- **Manticore (Sphinx fork).** Производительный, SQL-like, но меньше mainstream, AI пишет хуже, ops-внимание выше.
- **OpenSearch / Elasticsearch.** 2GB+ JVM, overkill для team 1-2 и тысяч документов.

**Триггер пересмотра на Meilisearch:** UX-метрика — relevance@5 <60% (manual annotation) или bounce rate на поиске >40%.

### 7. Vector DB: **pgvector в основной Postgres**, HNSW индекс

- Drizzle поддерживает `vector('embedding', { dimensions: 1536 })`.
- Одна БД = одни backups, один deploy, транзакционная гарантия INSERT строки + embedding.
- HNSW в pgvector 0.7+ быстрый на нашем scale.

**Триггер на Qdrant standalone:** vector count >5M или ANN p95 >100ms.

### 8. Cache: **один Redis 7+ instance с явной матрицей ответственностей**

Один Redis, обслуживающий cache + sessions + idempotency + rate-limit + queues одновременно, — это multi-purpose SPOF: падение Redis ломает auth, idempotency и очереди разом. Критичные данные (idempotency keys, critical jobs) не должны зависеть от volatile cache. Поэтому ответственности разнесены по durability-классам:

| Concern                                        | Storage                                     | Durability  | Failure behavior                       |
| ---------------------------------------------- | ------------------------------------------- | ----------- | -------------------------------------- |
| Application cache (`cache:`)                   | Redis                                       | volatile    | Re-fetch из Postgres                   |
| Rate limiting (`rl:`)                          | Redis                                       | volatile    | Reset window (acceptable)              |
| OIDC nonces / PKCE (`oidc:`)                   | Redis (TTL ≤5min)                           | volatile    | Re-issue (acceptable)                  |
| JWKS cache (`jwks:`)                           | Redis (TTL 10min)                           | volatile    | Re-fetch (acceptable)                  |
| Introspection cache (`intro:`)                 | Redis (TTL 60s)                             | volatile    | Re-fetch (acceptable)                  |
| **Idempotency keys**                           | **Postgres** (UNIQUE constraint)            | durable     | n/a                                    |
| **Critical jobs**                              | **Postgres outbox** → BullMQ worker         | durable     | Replay from outbox после Redis restart |
| Non-critical jobs (email send, webhook fanout) | BullMQ (Redis) + retry policy               | best-effort | At-least-once retry                    |
| **Session state**                              | **IdP** (по ADR-0001 §6 — не в нашем Redis) | IdP's DB    | IdP handles                            |

**Schema impact:**

- Таблица `idempotency_keys (key text PRIMARY KEY, scope text, created_at timestamptz, expires_at timestamptz)` в `packages/db/schema/` — TTL через cron cleanup.
- Таблица `job_outbox (id uuid PK, kind text, payload jsonb, status text, created_at, claimed_at, completed_at, attempt int)` для critical jobs.
- BullMQ драйнер читает `job_outbox` для critical job kinds; non-critical jobs шлются напрямую в BullMQ.
- Queue contract, имена очередей, idempotency-key policy, classification critical vs non-critical — см. `2026-05-18-ds-platform-bullmq-queue-contract-design`.

**Persistence v1:** AOF `appendonly yes appendfsync everysec` + daily RDB → backup в Timeweb Object Storage. Per-namespace eviction policy: `allkeys-lru` для cache namespace, `noeviction` для idempotency/queue namespaces. Health check + alerting обязательны pre-pilot.

**HA-триггер pre-pilot:** Redis Sentinel / managed HA активируется ПРИ ЛИБО `>1000 active users` ЛИБО `>1 unplanned restart за месяц` (не ждём v2). Cluster mode — v3 (memory >32GB или throughput >50k ops/s).

### 9. Cluster topology v1 — lifted to ADR-0012

> **Изменено 2026-05-18 (DSO-53):** содержимое cluster topology v1 (api-prod / data-prod / private network / orchestrator choice) вынесено в **ADR-0012 «Deployment Topology v1»** как канонический artifact. Полный inventory, cost envelope, rejected alternatives (K3s / Nomad / Swarm / single-VPS / multi-VPS-LB), preview-environments, maintenance window и staging-deferral — там же.

Data-layer-relevant параметры, которые ADR-0012 наследует от этой ADR (без изменений):

- Postgres + Redis живут на изолированном `data-prod` VPS без публичного IP.
- Связь api → data — только через приватную сеть Timeweb.
- Timeweb Object Storage — backups primary (ADR-0003 §2.4), user uploads, AI-pipeline artefacts.

---

## Consequences

### Положительные

- Один Postgres + один Redis = простая mental model для AI-агентов, простой deploy, простой backup.
- Pgvector + PG FTS в одной БД = транзакционные гарантии при INSERT строки + embedding + search index.
- Drizzle TS-schema = SSOT — нет divergence между ORM и runtime types; doc-as-SSOT принцип выполнен.
- Cerbos embedded = policies-as-code с тестами, без отдельного PDP-сервиса на v1.
- Partitioning с v1 → retroactive repaint не нужен; retention enforce'ится дешёвыми `DROP PARTITION`.
- Self-hosted Postgres → extensions без ограничений, full control над тюнингом, дешевле managed на 60-180k ₽/год.
- Outbox-pattern из ADR-0002 уже декаплит data-layer от destinations — отложенные решения (ClickHouse, Meilisearch, Qdrant) не требуют переделки emit-кода.

### Отрицательные

- Self-hosted Postgres ops on us: ~80-100 часов/год (backup verification, upgrades, monitoring, patches).
- Single Postgres-node v1 = single point of failure. SLO 99.0% это допускает, но требует disciplined backup + restore-drill.
- Cerbos в embedded mode = policy update требует redeploy. Mitigation: policies в отдельной папке, частые мелкие redeploy'и приемлемы на v1.
- pgvector + PG FTS делят I/O с OLTP. Mitigation: read-replica для тяжёлых search/vector запросов когда триггер сработает.
- Один Redis = SPOF для sessions/idem/rl/bull. v2 HA-триггер addresses.
- Drizzle младше Prisma — экосистема меньше, риск отсутствия features. Mitigation: SQL-first природа Drizzle позволяет fallback на raw SQL для любого edge-case без переключения ORM.

### Архитектурные качества (метрики, не декларации)

| Качество               | Метрика                           | v1             | v3                           |
| ---------------------- | --------------------------------- | -------------- | ---------------------------- |
| Availability           | uptime SLO                        | 99.0%          | 99.9%                        |
| RTO                    | После primary DB failure          | ≤2 часа        | ≤1 мин                       |
| RPO                    | Data loss window                  | ≤15 мин        | ≤30 сек                      |
| Data integrity         | Append-only ledger violation rate | 0 (DB trigger) | 0 + hash-chain daily         |
| Recoverability         | Restore-drill pass rate           | ≥95% weekly    | ≥99% daily                   |
| Search relevance       | Manual annotation @5 on sample    | ≥60%           | ≥85% или Meilisearch trigger |
| Vector ANN latency p95 | pgvector HNSW                     | ≤100ms         | ≤50ms или Qdrant trigger     |
| Cache hit rate         | course detail                     | ≥80%           | ≥95%                         |

---

## Open questions (deferred)

| OQ                                                                | Триггер пересмотра                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-D1. OLAP store (ClickHouse / TimescaleDB) vs read-replica      | Events ≥10M/день или v3 real-time dashboards                                                                                                                                                                                                                                           |
| OQ-D2. 6.2TB legacy архив — стратегия миграции/cold storage/proxy | Legal review авторских договоров + provider TBD                                                                                                                                                                                                                                        |
| OQ-D3. Retention duration для партиционированных таблиц           | **CLOSED 2026-05-18 (DSO-63 #6) — retention matrix в ADR-0009 §2.6 + design spec §3** (per entity/table: legal basis, retention period, deletion/anonymization, audit exception, owner). `audit_log` retention 5y (152-ФЗ + НК РФ + medical) с crypto-shred at term per ADR-0009 §2.4. |
| OQ-D4. Expand-contract migrations (pgroll)                        | v2 zero-downtime requirement                                                                                                                                                                                                                                                           |
| OQ-D5. Cerbos standalone PDP migration                            | v2 hot-reload без redeploy                                                                                                                                                                                                                                                             |
| OQ-D6. Tenant isolation (row-level vs schema-per-tenant)          | Появление первой DS Clinic (v3)                                                                                                                                                                                                                                                        |
| OQ-D7. Postgres HA (Patroni vs Timeweb managed HA tier)           | v2 99.5% SLO + concurrent ≥10k                                                                                                                                                                                                                                                         |
| OQ-D8. Append-only ledger integrity hash chain                    | Product требование cryptographic immutability (DAO scope DSO-30)                                                                                                                                                                                                                       |

## Делегировано

- **OLAP / DWH** — ADR-0004 при триггере OQ-D1.
- **6.2TB legacy архив strategy** — отдельная задача после legal Phase 0.
- **Retention duration** — отдельное product/compliance решение.
- **Tenant isolation детали** — DSO-26 продуктовая задача или новый ADR при появлении первой DS Clinic.
- **Right-to-erasure flow + consent management** — **ADR-0009 «PD Lifecycle, Consent, Retention, Erasure»** (2026-05-18, DSO-63 #5+#6) фиксирует архитектуру: consent_versions/acceptances/withdrawals + three erasure levels + per-subject crypto-shred. Реализация — design spec ADR-0009.
- **DSO-30 (AI runtime)** наследует pgvector decision; конкретные embeddings-модели — в DSO-30.
- **Frontend / Mobile** — DSO-28 / DSO-29 могут стартовать параллельно.
