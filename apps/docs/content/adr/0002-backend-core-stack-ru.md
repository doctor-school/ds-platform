---
title: "ADR-0002 — Backend Core Stack (язык / framework / validation / API style) для DS Platform [RU]"
description: "DS Platform — самостоятельная платформа, заменяющая Bubble + Directual + Supabase. Backend ядро должно обслуживать все клиенты (Web, Mobile, Admin,..."
lang: ru
---

> **EN:** [`0002-backend-core-stack-en.md`](./0002-backend-core-stack-en.md) · **RU (this)**

# ADR-0002 — Backend Core Stack (язык / framework / validation / API style) для DS Platform

**Дата:** 2026-05-13
**Статус:** Accepted
**Связан с:** Plane DSO-26 (`5556d45e-7b62-431e-8d6f-b8beca3386f0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0002-backend-core-stack-design-ru.md`
**Наследует:** ADR-0001 (Identity/Auth/RBAC)

---

## Context

DS Platform — самостоятельная платформа, заменяющая Bubble + Directual + Supabase. Backend ядро должно обслуживать все клиенты (Web, Mobile, Admin, partner integrations) и поддерживать:

- ~10–65k существующих врачей (миграция из Directual) + рост до 1M MAU к v3.
- API p95 ≤500ms (v1) → ≤300ms (v3); availability 99.0% (v1) → 99.5% (v2, HA trigger per ADR-0003 OQ-D7) → 99.95% (v3). Зафиксировано Amendment A1 (2026-05-18, DSO-59).
- Append-only ledger с антифрод-дедупом по `event_id`, audit-log ≥3 года.
- Async задачи (notifications, AI pipeline, PDF, marketing-рассылки 10k≤10мин).
- Webhooks для платежей, видеохостинга, AI-сервиса, SMS-callback.
- Real-time push при live-вебинарах с тысячами зрителей.
- Multi-tenant (DS Clinic = клиент-партиция).
- Hosting в РФ (152-ФЗ).
- AI-агенты — основной механизм разработки, стек должен быть LLM-friendly.
- Эксплуатация командой 1–2 человек.

ADR-0001 наследует: hybrid RBAC (fine-grained и object-level — в backend), mirror-users-table из IdP через outbox + reconcile, 23 audit-события, two-tier JWT/introspection validation.

---

## Decision

### 1. Runtime + язык: **Node.js 22 LTS + TypeScript 5.6+ strict**

- Soft constraint из prep: TS/Python предпочтительнее Go/Rust для AI-генерации; LLM лучше всего пишут TS-бэкенд.
- 3 прототипа на Next.js + React — фронт де-факто TS → один язык на бэк/фронт → типы текут end-to-end без cross-language codegen.
- Node 22 LTS до апр-2027, ESM-only, perf-улучшения V8.

**Отвергнуто:**

- **Go (Fiber/Gin/Echo).** Дал бы ~3× RPS на инстанс, но: AI пишет хуже (меньше обучающих данных), типы не текут в TS-фронт без codegen, найм Go в РФ дороже. Runtime-преимущество не оправдано при I/O-bound нагрузке (упор в БД, не CPU).
- **Python + FastAPI.** Подходящий выбор для AI-runtime (DSO-30), но как основной API: нет typed end-to-end, GIL ограничения, разделение AI-сервиса от основного backend становится сложнее.
- **Java + Spring Boot.** JVM-эксплуатация (2-4GB heap, GC) ресурсоёмче для команды 1-2; больше boilerplate; AI-friendliness ниже NestJS.
- **.NET + ASP.NET Core.** Привязка к Microsoft-экосистеме, в РФ-секторе найм ухудшается после ухода Microsoft.
- **Ruby on Rails.** Производительность ниже Node, найм Ruby в РФ упал 5-10×, экосистема стагнирует.
- **Rust / Elixir.** Экзотика в РФ-найме, AI-агенты пишут хуже.
- **Bun runtime.** NestJS на Bun официально не поддержан в production; в РФ-секторе не мейнстрим. Open question OQ1 — пересмотр при production-кейсах.

### 2. Framework: **NestJS 11 + Fastify-адаптер**

- Convention-over-configuration дисциплинирует AI-генерацию между сессиями/моделями.
- DI + модульная архитектура — готовые рельсы для cross-cutting concerns (RBAC, audit, throttle, tenancy) из ADR-0001.
- Декларативные guards / interceptors / pipes для two-tier JWT/introspection.
- Зрелые интеграции: `@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/throttler`, `@nestjs/swagger`, `@nestjs/helmet`.
- Fastify-адаптер: +30-50% RPS относительно Express без изменения NestJS API.
- РФ-найм Node/NestJS-разработчиков — самый востребованный TS-backend на hh.ru/Habr Career.

**Отвергнуто:**

- **Hono.** Lightweight (50MB image, <300ms cold start), end-to-end типизация через ts-rest. Но: моложе (меньше в LLM-датасете), нет готовой архитектуры (DI, guards, scheduled jobs пишутся руками), кросс-cutting concerns проектируются с нуля. Это плата за runtime-overhead, который при I/O-bound нагрузке не реализуется.
- **Fastify (без NestJS).** Самый быстрый из TS-фреймворков (70k RPS), но Plugin-API менее единообразен, чем декораторы NestJS — AI пишет менее консистентно. Меньше готовых решений для multi-tenant/RBAC.
- **Express.** Legacy-стек, mainstream, но: 30k RPS (хуже Fastify-адаптера NestJS), нет встроенной архитектуры, paradigma callback/middleware устаревает.
- **Koa.** Слабее экосистема, меньше материалов на русском, AI-агенты пишут хуже.

**Trade-off NestJS (известные минусы):** тяжёлый image (~150MB), cold start 1-2s, декораторы и DI = больше boilerplate. Компенсируется AI-генерацией.

### 3. Валидация: **Zod через `nestjs-zod` (single source of truth)**

Одна Zod-схема → TS-тип + runtime-валидация + OpenAPI 3.1 спека. Без дублирования.

**Точное имя пакета:** `nestjs-zod` (от risenforces, https://github.com/risenforces/nestjs-zod) — включает `ZodValidationPipe`, `createZodDto`, и интеграцию с `@nestjs/swagger`. НЕ `nestjs-zod-openapi` (другой менее распространённый пакет). НЕ `@anatine/zod-nestjs`.

**Защита от AI-расхождения:** custom eslint rule запрещает `class-validator` decorators и `@ApiProperty` в новом коде — форсирует Zod-only стиль (LLM регулярно скатываются на старую `@nestjs/swagger`+class-validator идиому).

**Отвергнуто:**

- **class-validator + class-transformer** (классический NestJS). Требует отдельных DTO-классов с декораторами; типы не текут из validation в OpenAPI без ручного маппинга. Держим в запасе как fallback при проблемах с zod-openapi генерацией.
- **TypeBox.** JSON Schema-нативный, легче, но менее ergonomic для composition; экосистема меньше.
- **Valibot.** Меньше бандл, но younger (меньше в LLM-датасете → AI пишет хуже).

### 4. API style v1: **REST + OpenAPI 3.1**

- Универсальный клиент: Web, Mobile (любой стек), Admin, partner integrations, webhook receivers.
- HTTP-кэширование "из коробки" на CDN — прямо влияет на performance.
- AI-генерация максимум; webhooks обязательно REST → один стиль.
- Простое версионирование (path-based `/v1/...`), observability, rate-limit.

**Отвергнуто на v1 (с условиями пересмотра):**

- **GraphQL.** Ломает CDN-кэширование (всё POST), security сложнее (depth-limit, query cost analysis), observability сложнее, webhooks всё равно REST. Open question OQ2: пересмотр на v2 как BFF-слой поверх REST, триггер — ≥3 толстых mobile-view с трафик-выгодой ≥30% или RTT ≥100ms.
- **tRPC.** Только TS-клиенты; mobile native (Swift/Kotlin) или Flutter не работают; внешние интеграции — REST.
- **gRPC.** Браузер напрямую не умеет; mobile native overkill; РФ-команд мало. Open question OQ4: пересмотр для internal service-to-service при расхождении монолита на ≥3 сервиса.

### 5. SDK для клиентов: **`openapi-typescript` codegen → `@ds/api-client` npm package**

OpenAPI спека генерируется из Zod-схем → CI пересобирает SDK → публикует в приватный npm-реестр (Verdaccio в инфре). Web и TS-мобайл получают типы + fetch-клиент. Для native mobile (Swift/Kotlin) — openapi-generator.

### 6. Async backbone: **BullMQ через `@nestjs/bullmq` + `@nestjs/schedule`**

- Redis уже есть (sessions из ADR-0001 §6, кэш).
- `@nestjs/bullmq` интегрирован в DI с типизацией.
- Гарантии: at-least-once, retry с backoff, DLQ после 5 fail'ов, идемпотентность задач на стороне worker'а.
- Forward-ref: контракт очередей, имена, retry/DLQ-политики, idempotency-keys — см. `2026-05-18-ds-platform-bullmq-queue-contract-design`.

**Отвергнуто:**

- **Temporal.** Durable workflows, но сложнее ops + overkill для нашего scope (нет 30-day flows). OQ3: пересмотр при появлении long-running flows (revenue share approval).
- **RabbitMQ / Kafka.** Отдельный broker, +инфра, +ops. Нет выгоды над Redis+BullMQ.
- **Celery.** Python-only.

### 7. Realtime gateway: **Centrifugo (отдельный Go-сервис)**

- Готовое решение для тысяч WS-коннектов (50k+ на инстанс).
- Снимает realtime-нагрузку с основного API.
- Presence, history, recovery — встроены.
- Developed by Russian dev (Alexander Emelin); документация на русском.

NestJS публикует события через Centrifugo HTTP API; клиенты подписываются на каналы (`user:<uuid>`, `webinar:<id>`, `leaderboard:global`).

WS внутри NestJS допустим только для низкочастотных low-fanout сценариев.

### 8. Object storage + CDN: **Timeweb Object Storage (S3-compat) + Timeweb CDN**

Зафиксировано на уровне инфры (DSO-10). Backend взаимодействует через AWS SDK v3 + тонкая обёртка `StorageService`. Публичные URL — через CDN, не через бэк.

### 9. API contract guarantees

- **Path-based versioning** (`/v1/...`).
- **Cursor-based pagination** default (offset только для admin).
- **RFC 7807 Problem Details** для ошибок + `errorCode` (stable, machine-readable) + `traceId` (OTel).
- **Idempotency-Key** обязательно для всех мутирующих endpoints, 24h Redis.
- **Authorization: Bearer JWT**; two-tier validation из ADR-0001.

### 10. Documentation-as-SSOT

Doc-first cycle, auto-generation везде где можно, CI-gates на consistency README↔код и spec↔ADR. Детали — §8 design spec.

**Главный принцип:** документация — единый источник правды для разработки, не побочный продукт. AI-сессия начинается с чтения Module README + связанного ADR.

---

## Consequences

### Положительные

- AI-агенты пишут код консистентно между сессиями (NestJS convention + auto-gen docs).
- Типы текут end-to-end от Zod через OpenAPI в SDK → расхождения between backend и фронт ловятся при `tsc`.
- Один язык на основной backend → ниже cognitive overhead для команды 1-2.
- Один Docker image на API + воркеры → проще деплой.
- Realtime нагрузка вынесена в Centrifugo → API не деградирует на пиках вебинаров.
- Документация = SSOT → переключение между сессиями/моделями не теряет контекст.

### Отрицательные

- NestJS Docker image ~150MB (vs ~50MB Hono) — приемлемо для VPS-деплоя.
- Cold start 1-2s (vs <300ms Hono) — не критично для long-running серверов.
- Декораторы и DI = в 1.5-2× больше boilerplate на простой endpoint — компенсируется AI-генерацией.
- Two runtimes в системе (Node основной + Go Centrifugo + потенциально Python AI в DSO-30) — две CI-цепочки, требует дисциплины.
- Lock-in на NestJS-декораторы — mitigation: ≥60% бизнес-логики в чистых сервисах без декораторов.
- `nestjs-zod` + OpenAPI генерация — мейнстрим с 2024 (relatively recent). Mitigation: явный eslint rule, fallback на classic `@nestjs/swagger` + class-validator при проблемах.
- **v1 availability = 99.0% single-AZ** (resolved 2026-05-18, Amendment A1 / DSO-59). 99.5% требует HA Postgres (+15-25k ₽/мес) — отложено до v2 по OQ-D7 в ADR-0003 (trigger: pre-pilot → pilot transition). Топология бэкапов / RPO / RTO — наследуется из ADR-0003 §2.4 + §9. Maintenance window 02:00–06:00 МСК исключён из SLO.
- **Outbox at-least-once** требует idempotency на стороне ВСЕХ consumer'ов (детали — spec §7.4). Cost: дополнительная сложность кода + UNIQUE-индексы в БД.

### Архитектурные качества (метрики, не декларации)

| Качество               | Метрика                                   | v1                                   | v2                 | v3            |
| ---------------------- | ----------------------------------------- | ------------------------------------ | ------------------ | ------------- |
| Scalability            | Horizontal scale-out factor               | 10× за 1 час                         | —                  | 100× за 1 час |
| Stack portability      | % бизнес-логики без NestJS-deps           | ≥60%                                 | —                  | ≥80%          |
| Reliability under load | Time-to-degradation при потере провайдера | ≥15 мин                              | —                  | ≥30 мин       |
| Recovery time          | RTO после primary DB failover             | ≤2 ч (manual restore, ADR-0003 §2.4) | ≤5 мин (HA)        | ≤1 мин        |
| Data integrity         | RPO                                       | ≤15 мин (WAL gap, ADR-0003 §2.4)     | ≤5 мин             | ≤30 сек       |
| Availability           | uptime SLO                                | 99.0%                                | 99.5% (HA trigger) | 99.95%        |

---

## Amendment A1 — v1 availability target resolved (2026-05-18, DSO-59)

**Источник:** Plane DSO-59. Закрывает OQ11.

**Контекст.** В оригинальном ADR-0002 (2026-05-13) performance budget декларировал availability 99.5% v1, при этом cons-секция признавала, что реалистично 99.0% single-AZ без HA Postgres. OQ11 оставлял выбор открытым. После DSO-63 external validation топология бэкапов и RPO/RTO для single-node v1 зафиксированы в ADR-0003 §2.4 + §9. Этот amendment синхронизирует ADR-0002 с уже принятыми решениями и формально закрывает OQ11.

**Решение.**

1. **v1 availability target = 99.0% single-node single-AZ.** Внешних SLA-обязательств перед партнёрами на момент решения нет (Phase 0 pre-pilot).
2. **Maintenance window:** одно еженедельное окно 02:00–06:00 МСК исключается из SLO calculation. Конкретный график — операционная деталь, фиксируется в DSO-10 readiness checklist, не в ADR.
3. **RPO / RTO** наследуются из ADR-0003 §2.4 (canonical backup topology): RPO ≤15 мин (WAL gap), RTO ≤2 ч (manual restore по runbook'у). Quarterly restore drill — часть DSO-10 AC (cross-link на engineering-readiness §4).
4. **Cost envelope:** v1 infra ≤30k ₽/мес total. HA Postgres (+15-25k ₽/мес) вне scope v1.
5. **Trigger пересмотра:** переход pre-pilot → pilot. На этом review оценивается OQ-D7 (Postgres HA — Patroni vs managed) из ADR-0003. До этого момента — single-node + WAL archiving + multi-provider offsite по ADR-0003 §2.4.

**Изменённые места в этом ADR.**

- §Context (L18): performance budget строка переписана с тремя точками (v1/v2/v3).
- §Consequences/Negative: строка про availability переписана из «trade-off open» в «resolved».
- §Architectural qualities: таблица расширена столбцом v2; строки Availability / RTO / RPO синхронизированы с ADR-0003.
- §Open questions: OQ11 → CLOSED + cross-ref.

**Cross-references.**

- ADR-0003 §2.4 (canonical backup topology), §9 (architectural qualities v1/v2/v3), OQ-D7 (v2 HA trigger).
- Design spec `2026-05-13-ds-platform-data-layer-design-{ru,en}.md` §2.4 + §9.
- Engineering-readiness spec §4 (quarterly restore drill — операционно anchored на DSO-10).
- ADR-0002 OQ10 (deployment topology) — отдельно, но теперь имеет фиксированный SLO target для cost estimate.

**Verification.** После применения amendment грепом убедиться, что в `0002-backend-core-stack-{ru,en}.md` любое упоминание `99.5%` либо относится к v2 (HA trigger), либо к v3 контексту, либо к историческому объяснению причины этого amendment. Команда:

```bash
grep -n "99\." apps/docs/content/adr/0002-backend-core-stack-ru.md apps/docs/content/adr/0002-backend-core-stack-en.md
```

---

## Open questions (deferred)

| OQ                                     | Триггер пересмотра                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OQ1. Bun как runtime                   | Production-поддержка NestJS на Bun + успешные кейсы в РФ                                                                        |
| OQ2. GraphQL BFF                       | v2: ≥3 толстых mobile-view с трафик-выгодой ≥30% или RTT ≥100ms                                                                 |
| OQ3. Temporal                          | При появлении long-running flows                                                                                                |
| OQ4. gRPC internal                     | При расхождении монолита на ≥3 сервиса                                                                                          |
| OQ5. Persisted queries                 | Если CDN-кэш недостаточен                                                                                                       |
| OQ6. PDF-движок                        | При реализации CertificatesModule v2                                                                                            |
| OQ7. Coverage minimums                 | v2 review                                                                                                                       |
| OQ8. Contract testing                  | Pact vs OpenAPI snapshot — при первой интеграции v1                                                                             |
| OQ9. AI скатывается на class-validator | Eslint no-class-validator rule >5 false-positives/неделю → пересмотр                                                            |
| OQ10. Deployment topology              | **CLOSED 2026-05-18 (DSO-53)** — см. ADR-0012 «Deployment Topology v1».                                                         |
| OQ11. v1 availability target           | **CLOSED 2026-05-18 (Amendment A1 / DSO-59)** — 99.0% v1 single-node single-AZ; см. ADR-0003 §2.4 + §9 + OQ-D7 (v2 HA trigger). |

## Делегировано

- **Primary DB** (DSO-27): PostgreSQL — рабочее предположение; формальное сравнение с MySQL/CockroachDB/Yugabyte/TiDB.
- **ORM, migrations, search, vector, cache layout, OLAP** — DSO-27.
- **Policy engine RBAC** (Cerbos/OPA/OpenFGA/SQL) — DSO-27. **Интерфейс `IPolicyEngine`** определён в DSO-26 (RbacModule) с in-memory mock; конкретный engine подключается без переписывания guards.
- **Frontend stack** — DSO-28.
- **Mobile stack** — DSO-29.
- **AI runtime, LLM middleware, AI-провайдеры** — DSO-30.
- **Repo layout** — DSO-31.
- **Финальный IdP (Authentik vs Zitadel)** — Phase 0 spike.
- **SMS/email-провайдеры, bot-protection** — отдельные задачи (в РФ failover ручной).
- **Deployment topology** — **закрыто 2026-05-18 (DSO-53):** см. **ADR-0012 «Deployment Topology v1»** (2-VPS docker-compose; K3s / Nomad / Swarm / single-VPS / multi-VPS-LB rejected; preview-environments + permanent staging deferred).
- **npm + Docker registry mirroring (Verdaccio + Harbor/Nexus)** — **DSO-10 (infra-readiness)**. Hard requirement v1 — без зеркал CI рискует ломаться при РФ-блокировках npm/Docker Hub.
- **НМО / Росздравнадзор интеграция** — отдельная задача. СМЭВ + XML + ГОСТ-подписи; не webhook-receiver, отдельный модуль возможно с .NET/Java вставкой через очередь.
- **Sandbox-стратегия webhook signature testing** (платежи, видеохостинг) — отдельная задача.
