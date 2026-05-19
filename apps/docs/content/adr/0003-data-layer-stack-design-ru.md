> **EN:** [`0003-data-layer-stack-design-en.md`](./0003-data-layer-stack-design-en.md) · **RU (this)**

# DS Platform — Data Layer design

**Дата:** 2026-05-13
**Notion title:** [BBM · DS] 2026-05-13 — DS Platform: Data Layer design
**Notion page ID:** —
**Мастер:** репозиторий → `apps/docs/content/adr/0003-data-layer-stack-design-ru.md`
**Автор:** Tech Lead Сидоров
**Связан с:** Plane DSO-27 (`bb877d3b-e922-4d8d-8e7b-9b33b4c941ee`), milestone DSO-24
**Наследует:** ADR-0001 (Identity/Auth/RBAC, hybrid RBAC, IPolicyEngine interface), ADR-0002 (Backend core: NestJS+TS, Zod, REST, BullMQ on Redis, Centrifugo, Timeweb storage/CDN, outbox pattern с consumer-side idempotency)
**Входы:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §3/§4/§8.3/§9.1/§9.3/§9.6, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `knowledge-base/documents/ds-platform-components/01-backend.md`
**Выход:** `apps/docs/content/adr/0003-data-layer-stack-ru.md` + входы для DSO-28..31

---

## 0. TL;DR

1. **Primary DB:** PostgreSQL 17, self-hosted в Docker на отдельном data-layer VPS. `pgbackrest` daily full + 15-min WAL → Timeweb Object Storage (offsite RF). Declarative partitioning by month для high-volume таблиц (`ledger`, `audit_log`, `events_log`) c v1, чтобы избежать retroactive repaint.
2. **ORM + Migrations:** Drizzle ORM (TS schema = SSOT) + drizzle-kit. Pgvector first-class через `vector(...)` тип. Сложные миграции (concurrent index, partitioning) — raw SQL внутри drizzle-kit-генерированных файлов.
3. **Policy engine (RBAC):** Cerbos в embedded mode на v1 (`@cerbos/embedded`). Политики в `policies/*.yaml`, версионируются, `cerbos compile --tests` в CI. `IPolicyEngine` из ADR-0002 — тонкая обёртка. Fast-path: in-process fine-grained checks для ≥99% read-запросов; Cerbos вызываем для high-stakes mutations и admin endpoints.
4. **Full-text search:** PostgreSQL FTS (tsvector + russian stemmer) + `pg_trgm` для fuzzy + GIN-индексы. Один store вместо отдельного search-сервиса.
5. **Vector DB:** pgvector в основной Postgres, HNSW индекс. Та же БД, те же backups, тот же deploy.
6. **Cache:** один Redis 7+ instance, keyspace namespacing (`session:`, `idem:`, `rl:`, `bull:`, `cache:`, `jwks:`, `intro:`). AOF everysec + RDB hourly. maxmemory 2GB v1, allkeys-lru.
7. **Облик кластера v1:** один data-layer VPS на Timeweb, два Docker-контейнера (Postgres + Redis), отдельная Docker network, доступ только из API-VPS через приватную сеть Timeweb.
8. **Что НЕ решено и почему OK на v1:** OLAP store (отложен, outbox-pattern из ADR-0002 декаплит emit от destination), 6.2TB legacy архив (отложен — зависит от legal/авторских), retention duration (отложен — партиционирование уже выбрано, retention — knob), expand-contract migrations (отложен — v1 деплои в окно низкой активности), Cerbos standalone PDP (отложен — hot-reload не критичен на v1).

---

## 1. Scope и non-goals

### В scope DSO-27

- Класс primary DB и конкретный движок (Postgres 17).
- Managed vs self-hosted на Timeweb (self-hosted).
- Версия Postgres (17).
- ORM/query-builder (Drizzle).
- Migration tool (drizzle-kit) + стратегия.
- Partitioning schema для high-volume таблиц.
- Policy engine (Cerbos embedded) + интеграция с IPolicyEngine из ADR-0002.
- Full-text search engine (PG FTS).
- Vector DB (pgvector).
- Cache layout (один Redis + namespacing).
- Cluster topology v1 (data-layer VPS, Docker, networking).
- Backup + restore strategy (pgbackrest + WAL + Timeweb Object Storage).

### Не в scope DSO-27 (delegated)

- **OLAP store** (ClickHouse / TimescaleDB) — ADR-0004 при триггере.
- **6.2TB legacy архив** — отдельная задача после legal-review.
- **Retention duration** (2/5/10 лет) — отдельное product/compliance решение.
- **Expand-contract migrations** (pgroll) — отдельная задача при v2 zero-downtime requirement.
- **Cerbos standalone PDP migration** — при v2 hot-reload requirement.
- **Object storage детали** (Timeweb S3-compat) — зафиксировано в ADR-0002 §8.
- **DPo / right-to-erasure flow реализация** — DSO-26 архитектурное требование, конкретная реализация — отдельная product задача.
- **Tenant isolation (DS Clinic multi-tenant)** — выбор между row-level scoping и schema-per-tenant — open question §6 OQ-D6, решается при появлении первой clinic.

---

## 2. Primary DB

### 2.1. Класс БД

**Решение:** реляционный, single-engine, single-node v1.

**Сравнение кандидатов:**

| Кандидат                             | Вердикт   | Причина                                                                                                                                                               |
| ------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL 17**                    | ✅ Выбран | JSON, FK, FTS, declarative partitioning, pgvector, logical replication, AI-friendly, managed-доступен в RF при необходимости                                          |
| MySQL 8 / MariaDB                    | Отвергнут | Слабее JSON, FTS хуже, нет pgvector-equivalent, экосистема Postgres шире для AI                                                                                       |
| CockroachDB / Yugabyte / TiDB        | Отвергнут | Нет managed в RF; self-hosting distributed cluster нерeally для team 1-2; CockroachDB Inc — US sanctions exposure; performance overhead не оправдан на 200→200k users |
| MongoDB / document DB                | Отвергнут | Append-only ledger требует транзакций и joins; document-модель будет переизобретать реляционность                                                                     |
| EventStoreDB / event sourcing native | Отвергнут | Экзотика в РФ, AI пишет хуже, ops complex. Append-only ledger реализуется поверх Postgres                                                                             |

### 2.2. Managed vs self-hosted

**Решение:** self-hosted PostgreSQL 17 в Docker на отдельном data-layer VPS Timeweb.

**Аргументы за self-hosted:**

1. Команда уже self-host'ит Plane, Authentik, GlitchTip на Timeweb — Postgres incremental, не новая дисциплина.
2. Extensions без провайдер-переговоров (pgvector, `pg_cron`, logical replication, любой кастом для DSO-30 AI-pipeline). Managed-провайдеры обычно ограничивают список расширений allowlist'ом.
3. 152-ФЗ — меньше data-processors; managed = Timeweb становится processor, требует отдельный DPA + аудит.
4. Cost: managed Postgres tier с репликой на Timeweb 5-15k ₽/мес; VPS уже оплачен. На v1 сэкономленные 60-180k ₽/год реальны для startup-фазы.
5. v1 scale tiny (200 users); reliability-премия managed (auto-backup, auto-failover) overkill для 99.0% SLO.
6. No vendor lock-in: переезд между Timeweb / Selectel / on-prem — `pg_dump | psql` или PITR-restore.

**Что мы теряем:**

- Backup discipline на нас (~6-10 часов setup, ~2 часа/квартал поддержки).
- Major version upgrade раз в год — 4-8 часов наших.
- v2 HA-требование (99.5%) сложнее — Patroni + etcd 3-node cluster vs managed checkbox.

**Митигация:**

- pgbackrest конфиг как код в репо, restore-drill еженедельно автоматизирован.
- Major upgrade — отдельное запланированное окно раз в 1-1.5 года.
- v2 HA — отдельный ADR (триггер 99.5% + concurrent ≥10k).

### 2.3. Версия

**Решение:** PostgreSQL 17 (pin minor в Docker tag, например `17.4-bookworm`).

**Аргументы за 17 (vs 16):**

1. **Logical replication failover** для replication slots и `pg_createsubscriber` tool — релевантно для будущего fan-out в ClickHouse (v2/v3 DWH).
2. **Incremental backups в pg_basebackup** — упрощает backup-стратегию.
3. **Vacuum memory-efficient** — значимо для 150M ledger records/мес.
4. **JSON_TABLE + SQL/JSON path** — лучше для events_log queries с JSONB payload.
5. Extension compatibility — pgvector, pgbackrest, pg_cron, pg_partman — все совместимы с 17 на 2026-05.

**Аргументы против 18:**

- Released Sep 2025, ~8 месяцев в проде на 2026-05 — early adopter risk на single team, patch releases ещё стабилизируются. Премии нет.

### 2.4. Backup + restore — canonical topology (DSO-63 #9, single source of truth)

> **Изменено 2026-05-18 (DSO-63 #9):** топология расширена до multi-provider offsite + separation of custody. Этот раздел — **single source of truth** для backup-стратегии. `engineering-readiness §4` ссылается сюда, не дублирует.

**Решение:** pgbackrest + WAL archiving + **multi-provider offsite (Timeweb primary + Beget S3 offsite)** + Vault-managed encryption keys на отдельной VM + quarterly restore drill.

**Топология:**

| Слой                           | Локация                                                                                       | Retention                                     | Цель                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| PITR / streaming WAL archiving | Timeweb Object Storage (primary RF, S3-compat)                                                | 7-30d                                         | RPO ≤15min                                            |
| Daily full backups             | Timeweb Object Storage                                                                        | 30d                                           | RTO ≤2h                                               |
| **Weekly offsite cold copy**   | **Beget S3** (RF, отдельный provider, отдельный legal entity — same-provider risk eliminated) | 90d                                           | provider-level disaster isolation                     |
| Quarterly archive              | Beget S3                                                                                      | 1y (или per retention matrix — ADR-0009 §2.6) | long-term compliance                                  |
| **Encryption keys (KEK)**      | Vault на отдельной VM (не Timeweb, не Beget) — separation of custody                          | rotated quarterly                             | защита от compromise одного из двух storage-providers |
| **Per-subject DEK**            | Postgres `subject_keys` table (encrypted by KEK)                                              | until erasure                                 | crypto-shred at erasure (ADR-0009 §2.5 + §5)          |

**Why Beget specifically:** RF-located, S3-compatible, отдельная legal entity (нет аффилиации с Timeweb), уже выбран для DNS — see [[reference_beget_dns]]. Same-provider backup не даёт disaster isolation (банкротство Timeweb / regulatory block унесёт и primary, и backup).

**Operational parameters:**

- pgbackrest daily full → Timeweb (primary).
- 15-min WAL archiving → Timeweb (primary).
- Weekly `rclone`/`aws s3 sync` job: Timeweb → Beget S3 (incremental).
- Encryption: pgbackrest шифрует backup перед загрузкой; KEK fetched via Vault API (network-restricted, only data-VPS imeет доступ).
- DEK per subject — encrypted-at-rest на каждом sensitive field (ADR-0009 §5); shredding DEK = effective erasure across all backup layers.

**Restore drill — quarterly (operational runbook):**

- Automated cron в staging cluster + smoke test query.
- Restore from each layer (Timeweb daily, Timeweb PITR, Beget weekly).
- Alert в GlitchTip если drill провалится.
- DSO-задача под DSO-10 (infra readiness) на runbook write-up.

**Erasure SLA compatibility:** crypto-shred per-subject ключа в Vault — immediate. Encrypted PD в backups становится нечитаемым **immediately** (live DB + Timeweb primary backup); physical tuple removal — на rotation (≤90d offsite). Соответствует 152-ФЗ ст. 14 (30 дней).

**RTO/RPO цели:**

- v1: RTO ≤2 часа (manual restore), RPO ≤15 мин (WAL gap).
- v2 (после HA-триггера): RTO ≤5 мин (Patroni failover или managed HA), RPO ≤5 мин.
- v3: RTO ≤1 мин, RPO ≤30 сек — требует synchronous replication, отдельный ADR.

### 2.5. Partitioning

**Решение:** declarative partitioning by month c v1 для high-volume таблиц.

**Партиционируемые таблицы:**

| Таблица            | Partition by                  | Причина                                                                                                                                 |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger`           | `RANGE (created_at)`, monthly | Append-only, потенциальный рост к v3; partition pruning ускоряет user-history queries; retention enforce'ится дешёвыми `DROP PARTITION` |
| `audit_log`        | `RANGE (created_at)`, monthly | ADR-0001 §1 audit-log требование, append-only                                                                                           |
| `events_log`       | `RANGE (created_at)`, monthly | Самый волатильный поток (presence, view ticks, gameplay events); месячная партиция = операционно удобный окно                           |
| `notifications`    | `RANGE (created_at)`, monthly | Очередь push/email/SMS, append-only                                                                                                     |
| `ai_pipeline_jobs` | `RANGE (created_at)`, monthly | Архивные job-записи + ссылки на артефакты в object storage                                                                              |

**Не партиционируем v1:** `users`, `courses`, `lessons`, `progress` — небольшие, FK-связаны с многим, partition overhead не окупается до >10M записей в таблице.

**Управление партициями:**

- `pg_partman` (как Postgres extension) — автоматическое создание новых партиций. На v1 drop-маска **выключена** — мы не знаем реального профиля роста (наша платформа не hiload до v2-v3). Включается при первом подтверждённом сценарии retention из observability (см. ниже).
- Создание партиций — `pg_partman` BGW + premake = 2-3 месяца вперёд.
- `pg_cron` оставляем для других recurring tasks.

**Retention — закрыто 2026-05-18 (DSO-63 #6): см. ADR-0009 §2.6 + PD-lifecycle design spec §3.**

Retention matrix per entity/table — в `packages/db/schema/pd/retention.ts` (TS-объект, CI-validated). Каждая таблица с PD имеет: legal basis, retention period, deletion/anonymization, audit exception, owner. Partition retention enforcement (`DROP PARTITION`) выполняется по retention matrix.

- `audit_log` retention — **5y** (152-ФЗ + НК РФ + medical compliance), crypto-shred at term (ADR-0009 §2.4).
- `events_log`, `notifications`, `ai_pipeline_jobs` retention — определяется в retention matrix.
- Observability с v1: alerts на размер каждой партиционируемой таблицы (Loki + Grafana из engineering-readiness spec) — сохраняется как backup-safety net.

### 2.6. Extensions

**Включаем v1:**

- `pgvector` — vector search.
- `pg_trgm` — fuzzy search (LIKE с триграммами).
- `pg_partman` — partition management.
- `pg_cron` — scheduled SQL jobs.
- `pg_stat_statements` — observability (slow queries).
- `pgaudit` — на рассмотрение, если ADR-0001 audit-requirements не закрыть на app-уровне.

**Russian FTS dictionary** — встроен в Postgres (`russian` text search configuration), включаем без дополнительной установки.

### 2.7. Append-only ledger pattern

**Решение:** поверх обычной таблицы Postgres, не отдельный event-store engine.

**Контракт `ledger`:**

- PK = UUID v7 (timestamp-ordered, лучше для индексов чем UUID v4).
- `event_id` UNIQUE — антифрод-дедуп на уровне БД (idempotent ingest для mobile offline sync — digest §5; см. ADR-0005 mobile sync).
- `created_at` NOT NULL, partition key.
- `INSERT`-only. UPDATE и DELETE запрещены на уровне DB trigger + ORM-layer guard. Корректировки — компенсирующие записи.
- Integrity hash chain (опционально v2): каждая запись хранит `prev_hash` = hash(prev row); ежедневный cron проверяет целостность цепочки. На v1 — append-only + UNIQUE event_id достаточно.

**Аналогично `audit_log`** — те же правила, разные columns.

---

## 3. ORM + Migrations

### 3.1. Решение

- **ORM/query-builder:** Drizzle ORM
- **Migration tool:** drizzle-kit

### 3.2. Почему Drizzle

| Критерий             | Drizzle                                           | Prisma                                                       | TypeORM                                         |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| Partitioning support | ✅ Native (можно писать `pgTable` с partition-by) | △ Через `migration.sql` raw escape                           | △ Через `@Entity` с лимитациями                 |
| pgvector             | ✅ First-class `vector(...)` type                 | △ Preview-flag + workarounds                                 | ❌ Нет                                          |
| Doc-as-SSOT          | ✅ TS-schema = единственный источник              | △ Отдельный `.prisma` DSL + codegen в TS                     | △ Декораторы внутри классов                     |
| Runtime overhead     | ✅ Zero (просто SQL builder + drivers)            | ❌ Query Engine binary +30MB                                 | ✅ Zero                                         |
| AI-friendly          | △ Минимальный API, AI пишет через 2-3 примера     | ✅ Огромный датасет, но AI часто пишет outdated 2.x паттерны | ❌ AI часто пишет 0.2 legacy, не работает в 0.3 |
| NestJS integration   | ✅ Native через providers                         | ✅ Через `nestjs-prisma`                                     | ✅ Через `@nestjs/typeorm`                      |
| Maturity             | △ Стабилен с 2024, активная разработка            | ✅ Зрелый, в проде >5 лет                                    | △ В maintenance-mode 0.3                        |

**Главное:** наша схема не CRUD-heavy, а ledger + audit + events с месячными партициями. Prisma на этом ломается через `migration.sql` raw escape — теряем declarative gain. Drizzle SQL-first wins.

### 3.3. Schema organization

- `packages/db/schema/` — TS-файлы по доменам (`users.ts`, `courses.ts`, `ledger.ts`, ...). Master location per ADR-0003 Amendment A1 (formerly `apps/api/src/db/schema/` per ADR-0003 §4).
- Каждый файл экспортирует `pgTable` definitions, indexes, foreign keys.
- Один `packages/db/schema/index.ts` re-export'ит всё.
- Drizzle infer type'ы: `type User = typeof users.$inferSelect`, `type NewUser = typeof users.$inferInsert`.
- Zod-схемы для request/response (из ADR-0002) — отдельно, не дублируют Drizzle-схемы, но генерируются через `drizzle-zod` где возможно.

### 3.4. Migrations workflow

- `drizzle-kit generate:pg` — diff между TS-schema и `__drizzle_migrations` метатаблицей → SQL-файл в `apps/api/drizzle/`.
- SQL-файлы committed в репо, human-editable (для concurrent index, partition management, RLS).
- `drizzle-kit migrate` (или `drizzle-orm migrator`) применяет в порядке нумерации.
- В CI — migration dry-run против staging БД перед merge в `main`.
- Production deployment — миграция запускается отдельным job step ДО redeploy API; rollback стратегия — backward-compatible миграции (новые колонки `NOT NULL DEFAULT` + nullable cleanup на следующем релизе).

### 3.5. Известные ограничения и митигация

- **Drizzle-kit не делает expand-contract автоматически.** Митигация v1: деплои в окно низкой активности (200 users — терпимо); destructive миграции вручную split'им на 2 релиза (add new column / backfill / drop old).
- **OQ-D4 (open question):** при v2 zero-downtime requirement — рассмотреть pgroll поверх drizzle-kit для destructive миграций.

---

## 4. Policy engine (RBAC)

### 4.1. Решение

**Cerbos в embedded mode на v1.**

- Embedded SDK: `@cerbos/embedded` для Node.
- Политики компилируются в bundle при build → выполняются in-process в Node, sub-ms latency.
- Hot-reload — через redeploy (приемлемо на v1).
- Standalone PDP — open question OQ-D5, триггер v2.

### 4.2. Почему Cerbos

| Кандидат             | Подходит  | Причина                                                                                                                                                   |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cerbos**           | ✅        | Специализирован под AuthZ, YAML+CEL (AI-friendly), decision audit log из коробки, single Go-binary, test framework для политик, hot-reload, embedded mode |
| OPA                  | Отвергнут | General-purpose, Rego синтаксис сложнее YAML, AI пишет хуже, не специализирован под AuthZ                                                                 |
| OpenFGA / SpiceDB    | Отвергнут | Zanzibar-like ReBAC избыточен для 9 ролей × 20-30 объектов; добавит граф-моделирование без необходимости                                                  |
| SQL-based в Postgres | Отвергнут | Проверки авторизации размазаны по коду, audit недетерминированный, миграция политик = миграция БД                                                         |
| Casbin               | Отвергнут | Зрелый, но AI пишет хуже Cerbos YAML, экосистема меньше                                                                                                   |
| Самописное в TS      | Отвергнут | Fine-grained + object-level + multi-role быстро превращается в спагетти                                                                                   |

### 4.3. Архитектура интеграции

```
[ NestJS Guard ]
       │
       ▼
[ IPolicyEngine (interface from ADR-0002) ]
       │
       ├── v1: CerbosEmbeddedPolicyEngine (@cerbos/embedded)
       └── v2+: CerbosRemotePolicyEngine (@cerbos/grpc → PDP sidecar)
```

### 4.4. Политики

- **Расположение:** `policies/*.yaml` в репо, версионируются как код.
- **Структура:** одна политика на ресурс (например, `policies/course.yaml`, `policies/ledger.yaml`).
- **Тесты:** `cerbos compile --tests` запускается в CI как build step; покрытие политик тестами — required CI gate.
- **PR-процесс:** изменение политики = код-ревью обязательно (хотя бы AI-reviewer на v1 + human на high-stakes ресурсах).

### 4.5. Fast-path для read-запросов

Cerbos call для каждого read-запроса добавит несколько-ms latency × ≥99% запросов = плохая API p95.

**Стратегия two-tier (симметрично с ADR-0001 JWT/introspection two-tier):**

- **Read-paths + low-stakes write** — `roles[]` из JWT принципала достаточно для guard'а; in-process check без Cerbos.
- **High-stakes mutations** (payments, AU withdrawal, role-change, admin mutations, PII export) — Cerbos вызывается, fine-grained policy + object-level attributes.

Классификация endpoints — explicit per-route decorator (`@PolicyCheck('cerbos')` vs default in-process).

---

## 5. Full-text search

### 5.1. Решение

**PostgreSQL FTS** (tsvector + russian stemmer + GIN-индексы) + `pg_trgm` для fuzzy на v1.

### 5.2. Почему

- Контент v1 = курсы, уроки, глоссарий, клинические кейсы. Объём = сотни-тысячи документов, v3 = десятки тысяч. Postgres FTS справится до 10M+ документов без проблем.
- Русский морфологический stemmer встроен (`russian` text search configuration).
- Нет отдельного сервиса = нет sync overhead, нет дублирования backups.
- AI отлично пишет SQL FTS.

### 5.3. Схема

```sql
ALTER TABLE courses ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('russian', coalesce(description,'')), 'B') ||
    setweight(to_tsvector('russian', coalesce(tags,'')), 'C')
  ) STORED;

CREATE INDEX courses_search_idx ON courses USING GIN (search_tsv);
```

`pg_trgm` для fuzzy / typo-tolerance — отдельный GIN-индекс по полю с `trigram_ops`.

### 5.4. Триггер пересмотра на Meilisearch

UX-метрика (admin-аналитика с v1):

- relevance@5 <60% (manual annotation на sample queries), или
- bounce rate на поиске >40%.

В этом случае Meilisearch как отдельный сервис, sync через outbox-pattern из ADR-0002 (тот же outbox для других destinations).

---

## 6. Vector DB

### 6.1. Решение

**pgvector в основной Postgres**, HNSW индекс.

### 6.2. Почему

- AI content pipeline (DSO-30) на v2-v3 — embeddings для рекомендаций уроков/курсов, semantic search по глоссарию/кейсам. Объём: десятки тысяч документов × embedding 1536-dim = до 100M float'ов = манагеабельно в Postgres.
- Drizzle первоклассно поддерживает: `vector('embedding', { dimensions: 1536 })`.
- Одна БД = одни backups, один deploy, один transaction-boundary при INSERT строки + embedding.
- HNSW индекс в pgvector 0.7+ быстрый.

### 6.3. Альтернатива и триггер

**Qdrant standalone** — когда:

- vector count >5M (на текущей оценке достижимо к v3), или
- ANN p95 >100ms (зависит от tuning HNSW `m`/`ef_construction`).

В этом случае — отдельный Qdrant-инстанс на data-layer VPS, sync через outbox.

---

## 7. Cache + Redis responsibilities matrix

> **Изменено 2026-05-18 (DSO-63 #10):** explicit responsibilities matrix по durability classes. Single Redis больше не multi-purpose SPOF — критичные concerns (idempotency keys, critical jobs) переехали в Postgres. Sessions — в IdP (ADR-0001 Amendment A2). См. ADR-0003 Amendment A2/§A.

### 7.1. Решение

Один Redis 7+ instance для **volatile concerns only**. Durable concerns (idempotency keys, critical jobs, audit log, PD) — в Postgres. Session state — в IdP, не в нашем Redis.

### 7.2. Responsibilities matrix (durability classes)

| Concern              | Storage                             | Namespace / Table                            | Durability  | TTL                      | Failure behavior                       |
| -------------------- | ----------------------------------- | -------------------------------------------- | ----------- | ------------------------ | -------------------------------------- |
| Application cache    | Redis                               | `cache:course:<id>`, `cache:lb:global`, etc. | volatile    | 5-15 min                 | Re-fetch from Postgres                 |
| Rate limiting        | Redis                               | `rl:<bucket>:<id>`                           | volatile    | окно (15 мин / час)      | Reset window (acceptable)              |
| OIDC nonces / PKCE   | Redis                               | `oidc:<state>`                               | volatile    | ≤5 min                   | Re-issue (acceptable)                  |
| JWKS cache           | Redis                               | `jwks:<kid>`                                 | volatile    | 10 min                   | Re-fetch (acceptable)                  |
| Introspection cache  | Redis                               | `intro:<jti>`                                | volatile    | 60 s                     | Re-fetch (acceptable)                  |
| Non-critical jobs    | Redis (BullMQ)                      | `bull:<queue>:*`                             | best-effort | per-job                  | At-least-once retry policy             |
| **Idempotency keys** | **Postgres**                        | `idempotency_keys` (UNIQUE)                  | **durable** | 24h via cron cleanup     | n/a                                    |
| **Critical jobs**    | **Postgres outbox + BullMQ worker** | `job_outbox` + `bull:critical:*`             | **durable** | retained until completed | Replay from outbox after Redis restart |
| **Session state**    | **IdP** (ADR-0001 Amendment A2)     | IdP's DB                                     | durable     | refresh-token TTL        | IdP handles                            |
| Audit ledger, PD     | Postgres                            | per ADR-0003 §6 + ADR-0009 retention matrix  | durable     | per ADR-0009 §2.6        | n/a                                    |

### 7.3. Конфиг (Redis)

- Redis 7+ (pin patch-version в Docker tag).
- `maxmemory: 2GB` v1, scale-up по мониторингу.
- Per-namespace eviction policy:
- `cache:*` → `allkeys-lru` (стандарт для cache).
- `oidc:*`, `intro:*`, `jwks:*` → `volatile-lru` (TTL-bound).
- `bull:*` → `noeviction` (job loss недопустим даже для non-critical).
- `rl:*` → `allkeys-lru` (reset acceptable).
- **Persistence:** AOF `appendonly yes appendfsync everysec` + RDB daily snapshot.
- **Backup:** Redis RDB snapshot → Timeweb Object Storage daily (rotation 7d).
- **Health check + alerting:** GlitchTip alert на unplanned restart (входит в HA trigger conditions).
- TLS — для inter-VPS трафика (если в v2 Redis вынесем на отдельный VPS); v1 рядом с API и Postgres = можно без TLS внутри Docker network.

### 7.4. Postgres-side schemas

Новые таблицы в `packages/db/schema/`:

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

Cron cleanup `idempotency_keys` (`pg_cron` ежечасный): `DELETE WHERE expires_at < NOW()`.

BullMQ drainer worker — отдельный process, читает `job_outbox WHERE status = 'pending'`, ставит в BullMQ соответствующей queue, помечает `claimed_at`. При retry — увеличивает `attempt`, max attempts из per-kind config.

> **Forward-ref:** полный queue contract — имена очередей, payload-схемы (Zod), retry/backoff/DLQ matrix, idempotency-keys per job-kind, queue→worker привязка, classification critical vs non-critical — см. **`2026-05-18-ds-platform-bullmq-queue-contract-design`**.

### 7.5. HA-trigger (изменён, pre-pilot — DSO-63 #10)

Redis Sentinel / managed HA активируется ПРИ ЛИБО:

- (a) `>1000 active users` (concurrent), ЛИБО
- (b) `>1 unplanned restart за месяц` (фиксируется через GlitchTip alert).

До этого — single-node + AOF + daily RDB backup acceptable. Не ждём v2.

Redis Cluster mode — только если memory >32GB или throughput >50k ops/s — v3 problem.

---

## 8. Cluster topology v1

```
┌─────────────────────────────────────────────────────────┐
│ Timeweb VPS "api-prod"                                  │
│  ├── NestJS API (Docker)                                │
│  ├── BullMQ workers (Docker, same image)                │
│  ├── Centrifugo (Docker)                                │
│  └── Cerbos embedded (in-process в NestJS)              │
└─────────────────────────────────────────────────────────┘
                       │
                       │  приватная сеть Timeweb
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
│  ├── User uploads (через ADR-0002 §8)                   │
│  └── AI pipeline artefacts                              │
└─────────────────────────────────────────────────────────┘
```

**Сетевая изоляция:**

- Data-VPS не имеет публичного IP в production (только приватная сеть Timeweb).
- Postgres/Redis biнды на private interface.
- Staging environment — отдельный VPS того же layout (или один data-VPS с двумя Docker network namespace'ами; решение отдельно при cost estimate v1).

---

## 9. Architectural qualities

| Качество                       | v1                             | v2                            | v3                               |
| ------------------------------ | ------------------------------ | ----------------------------- | -------------------------------- |
| Availability SLO               | 99.0% (single-node)            | 99.5% (HA-триггер)            | 99.9% (multi-AZ ADR-?)           |
| RTO                            | ≤2 часа (manual restore)       | ≤5 мин (Patroni / managed HA) | ≤1 мин (synchronous replication) |
| RPO                            | ≤15 мин (WAL gap)              | ≤5 мин                        | ≤30 сек                          |
| Backup test cadence            | Weekly automated restore-drill | Daily                         | Continuous                       |
| Migration zero-downtime        | Окно низкой активности         | pgroll (триггер)              | Required                         |
| Search latency p95             | ≤200ms (PG FTS)                | ≤100ms                        | ≤50ms                            |
| Vector ANN latency p95         | ≤100ms (pgvector HNSW)         | ≤50ms                         | Qdrant (триггер)                 |
| Cache hit rate (course detail) | ≥80%                           | ≥90%                          | ≥95%                             |

---

## 10. Documentation-as-SSOT

### 10.1. Source-of-truth артефакты

- Drizzle schema TS-файлы — single source для DB-структуры.
- Cerbos policies `policies/*.yaml` — single source для permissions; auto-doc через `cerbos generate documentation` в CI → выкладывается в Module README.
- README в `packages/db/` (per ADR-0003 Amendment A1) объясняет: схему, partitioning, backup-стратегию, extensions list, restore-runbook. Этот README — обязательное чтение для AI-session, начинающей работу с data-layer.
- ADR-0003 — для cross-cutting решений; spec-этот-файл — для деталей.

### 10.2. ERD / schema documentation tooling

**Решение:** **Liam ERD** (https://liambx.com) — open-source TypeScript tool, читает Drizzle schema, генерирует interactive HTML ERD.

**Почему Liam:**

- Open-source (Apache 2.0), self-host'имый.
- Нативно поддерживает Drizzle schema как input — без промежуточной DBML-конвертации.
- Interactive viewer (panning, поиск по таблицам, диплинки) — лучше статичной картинки.
- Auto-deploy через CI: при каждом merge в `main` → generate ERD HTML → publish в internal docs-сайт (или GitHub Pages, или Notion-embed).

**Дополнительные инструменты:**

- **Mermaid ER-диаграмма** в `packages/db/README.md` (per ADR-0003 Amendment A1) — текстовая, человекочитаемая, версионируется в git, авто-рендерится в GitHub/Notion. Генерируется отдельным скриптом из Drizzle schema (или поддерживается via `drizzle-zero-erd`/community plugin). Это «text-mode» дубль для AI-агента и code-review (Liam HTML смотреть в браузере неудобно во время PR-ревью).
- **SchemaSpy** (опционально, после v1) — Java-based tool, генерирует HTML-доки + статистика **из живой БД** (не из schema-файлов). Полезен для verification «реальная БД совпадает с задуманной schema» и для visualizing index usage / statistics. Запускается раз в неделю как cron-job в CI против staging.

**Отвергнуто:**

- **dbdocs.io** / **dbdiagram.io** — cloud-only, RF-доступность непредсказуема, DBML — промежуточный формат, дублирует Drizzle schema.
- **drizzle-kit introspect** в чистом виде — только дамп схемы в TS, не human-readable doc.
- **Самописная mermaid-генерация** — overhead vs Liam.

### 10.3. CI integration

В `.github/workflows/docs.yml` (или эквивалент в Gitea Actions):

- При push в `main` → `liam erd build` → артефакты HTML.
- Публикация HTML на internal docs-host (Timeweb VPS + nginx) или в Notion-embed.
- Mermaid auto-update в `packages/db/README.md` (per ADR-0003 Amendment A1) через pre-commit hook (или PR-bot который пушит regenerated mermaid обратно в PR).
- Diff в ERD блокирует merge без code review — guard rail против неосознанных schema changes.

---

## 11. Open questions (deferred, по приоритету)

| OQ                                                                    | Триггер пересмотра                                                                                                                                                                                                                                                                                                          | Когда               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **OQ-D1.** OLAP store (ClickHouse / TimescaleDB) vs read-replica      | Events ≥10M/день или v3 real-time dashboards                                                                                                                                                                                                                                                                                | v2/v3               |
| **OQ-D2.** 6.2TB legacy архив — стратегия миграции/cold storage/proxy | Legal review авторских договоров + provider TBD                                                                                                                                                                                                                                                                             | После legal Phase 0 |
| **OQ-D3.** Retention duration для партиционированных таблиц           | **CLOSED 2026-05-18 (DSO-63 #6)** — retention matrix в **ADR-0009 §2.6 + PD-lifecycle design spec §3** (per entity/table). `audit_log` retention 5y. `events_log`, `notifications`, `ai_pipeline_jobs` — фиксируются в retention matrix. CI gate `lint-retention` валидирует, что любая new PD-bearing таблица имеет entry. | —                   |
| **OQ-D4.** Expand-contract migrations (pgroll)                        | v2 zero-downtime requirement (concurrent users ≥5k 24/7)                                                                                                                                                                                                                                                                    | v2                  |
| **OQ-D5.** Cerbos standalone PDP migration                            | v2 hot-reload без redeploy                                                                                                                                                                                                                                                                                                  | v2                  |
| **OQ-D6.** Tenant isolation (row-level vs schema-per-tenant)          | Появление первой DS Clinic (v3)                                                                                                                                                                                                                                                                                             | v3                  |
| **OQ-D7.** Postgres HA (Patroni vs Timeweb managed HA tier)           | v2 99.5% SLO + concurrent ≥10k                                                                                                                                                                                                                                                                                              | v2                  |
| **OQ-D8.** Append-only ledger integrity hash chain                    | Если product потребует cryptographic immutability (DAO scope)                                                                                                                                                                                                                                                               | DSO-30 v2+          |

---

## 12. Consequences

### Положительные

- Один Postgres + один Redis = простой mental model для AI-агентов, простой deploy, простой backup.
- Pgvector + PG FTS в одной БД = транзакционные гарантии при INSERT строки + embedding + search index.
- Drizzle TS-schema = SSOT — нет divergence между ORM и runtime types.
- Cerbos embedded = policies-as-code с тестами, без отдельного PDP-сервиса на v1.
- Partitioning с v1 → retroactive repaint не нужен; retention enforce'ится дешёвыми `DROP PARTITION`.
- Self-hosted Postgres → extensions без ограничений, full control над тюнингом, дешевле managed.

### Отрицательные

- Self-hosted Postgres ops on us: ~80-100 часов/год (backup verification, upgrades, monitoring, patches).
- Single Postgres-node v1 = single point of failure. SLO 99.0% это допускает, но требует disciplined backup + restore-drill.
- Cerbos в embedded mode = policy update требует redeploy. Mitigation: policies в отдельном репо/папке, частые мелкие redeploy'и приемлемы на v1.
- pgvector + PG FTS делят I/O с OLTP. Mitigation: read-replica для тяжёлых search/vector запросов когда триггер сработает.
- Один Redis = SPOF для sessions/idem/rl/bull. v2 HA-триггер addresses.

### Архитектурные качества (см. §9 для метрик)

| Качество                | Метрика                           | v1             | v3                             |
| ----------------------- | --------------------------------- | -------------- | ------------------------------ |
| Data integrity          | Append-only ledger violation rate | 0 (DB trigger) | 0 + hash-chain verify daily    |
| Recoverability          | Restore-drill pass rate           | ≥95% weekly    | ≥99% daily                     |
| Search relevance        | Manual annotation @5 on sample    | ≥60%           | ≥85% (или Meilisearch trigger) |
| Schema migration safety | Failed migration in prod          | 0 (CI dry-run) | 0 + zero-downtime              |

---

## 13. Следующие шаги

1. Закрытие DSO-27 в Plane с результирующим комментарием (артефакты: этот spec + ADR-0003).
2. Открытие зависимых задач: DSO-28 (Frontend), DSO-29 (Mobile) — могут стартовать параллельно после DSO-27. DSO-30 (AI/runtime) использует pgvector decision из этого ADR.
3. Создание follow-up задач в Plane для open questions OQ-D1..OQ-D8 (часть привязывается к v2-милстоунам, часть к product gates).
4. DSO-56 (sandbox webhook) разблокирован.
