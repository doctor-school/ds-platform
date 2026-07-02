---
title: "DS Platform — Backend Core design [RU]"
description: "1. Runtime + язык: Node.js 22 LTS + TypeScript 5.6+ strict. Soft constraint из prep — AI-агенты лучше всего пишут TS-бэкенд; типы текут end-to-end до..."
lang: ru
---

> **EN:** [`0002-backend-core-stack-design-en.md`](./0002-backend-core-stack-design-en.md) · **RU (this)**

# DS Platform — Backend Core design

**Дата:** 2026-05-13
**Мастер:** репозиторий → `apps/docs/content/adr/0002-backend-core-stack-design-ru.md`
**Автор:** Tech Lead Сидоров
**Связан с:** Plane DSO-26 (`5556d45e-7b62-431e-8d6f-b8beca3386f0`), milestone DSO-24
**Наследует:** ADR-0001 (Identity/Auth/RBAC), spec `0001-identity-provider-shortlist-design-ru.md`
**Входы:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.2/§4/§9.1/§9.4/§9.7, `knowledge-base/documents/ds-platform-components/01-backend.md`, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-ru.md`
**Выход:** `apps/docs/content/adr/0002-backend-core-stack-ru.md` + входы для DSO-27..31

---

## 0. TL;DR

1. **Runtime + язык:** Node.js 22 LTS + TypeScript 5.6+ strict. Soft constraint из prep — AI-агенты лучше всего пишут TS-бэкенд; типы текут end-to-end до фронта/мобайла; РФ-найм Node-разработчиков ≫ Go/Elixir.
2. **Framework:** NestJS 11 с Fastify-адаптером. Convention-over-configuration дисциплинирует AI-генерацию; готовые guards/interceptors/pipes для cross-cutting concerns (RBAC, audit, throttle, tenancy) из ADR-0001.
3. **Validation:** Zod через `nestjs-zod` как single source of truth — одна Zod-схема порождает TS-тип, runtime-валидацию, и OpenAPI 3.1 спеку.
4. **API style v1:** REST + OpenAPI 3.1. GraphQL отвергнут на v1 (ломает CDN-кэширование, требует двух стилей с webhooks); пересмотр на v2 с конкретным триггером — см. §6 OQ2.
5. **SDK:** `openapi-typescript` codegen из OpenAPI → один TS-клиент для Web и Mobile (если mobile = TS), либо OpenAPI → нативные клиенты через openapi-generator.
6. **Async:** BullMQ через `@nestjs/bullmq` на Redis (Redis уже есть для сессий/кэша); cron через `@nestjs/schedule` + Redis-lock.
7. **Realtime:** Centrifugo как отдельный Go-сервис (выносит WS-нагрузку из основного API; готовое решение для тысяч concurrent зрителей вебинаров).
8. **Object storage + CDN:** Timeweb Object Storage (S3-compat) + Timeweb CDN (зафиксировано на уровне infra — DSO-10).
9. **API contract guarantees:** path-based versioning (`/v1/...`), cursor-based pagination, RFC 7807 Problem Details для ошибок, обязательный `Idempotency-Key` для всех мутаций.
10. **Documentation-as-SSOT:** doc-first cycle (spec → ADR → Module README → код); auto-gen везде где можно (OpenAPI, TypeDoc, Compodoc); CI-gates на consistency README↔код, spec↔ADR. См. §8.
11. **БД не зафиксирована в DSO-26.** PostgreSQL — рабочее предположение, финальный выбор в DSO-27 с формальным сравнением кандидатов (см. §6).
12. **Архитектурные качества как метрики, не декларации:** scalability factor, stack portability (%), time-to-degradation, RTO, RPO, availability SLO — см. §5.

---

## 1. Scope и non-goals

### В scope DSO-26

- Выбор языка / runtime / фреймворка / валидации / стиля API / OpenAPI-генерации.
- Архитектурный паттерн backend (монолит-first, NestJS-модули, воркеры в том же кодбейзе).
- Контракт API (URL, pagination, error model, idempotency, auth headers).
- Realtime-шлюз и async-очередь.
- Performance budget и обязательный чек-лист скорости (§5.2).
- Documentation workflow и docs-as-SSOT принцип (§8).
- Архитектурные качества и их метрики (§5.6).
- **152-ФЗ compliance gap из ADR-0001:** consent management подсистема (фиксация согласий + отзыв ч.3 ст.9) и right-to-erasure flow (ст.21) — архитектурные требования зафиксированы в §5.5; конкретные модули (`ConsentModule`, `ErasureModule`) добавляются в snapshot §3.1 для v1.
- **ROPA (Registry of Processing Activities) журнал** — отдельная подсистема логирования операций над ПДн (157-ФЗ требование), параллельная audit-log (§5.5).
- **Policy engine interface contract** (`IPolicyEngine`) с in-memory/SQL mock-реализацией — чтобы guards в DSO-26 не привязывались к конкретному engine, который выбирается в DSO-27 (§3.2).

### Не в scope DSO-26 (delegated)

- **БД-движок и ORM** — DSO-27 (с явным списком кандидатов в §6).
- Frontend-стек — DSO-28.
- Mobile-стек — DSO-29.
- AI runtime (LangGraph и т.п.) — DSO-30.
- Repo layout (monorepo vs polyrepo) — DSO-31.
- IdP — Zitadel (закрыт по ADR-0001 §8, DSP-209).
- SMS / email-провайдер с failover-схемой, bot-protection — отдельные задачи.

---

## 2. Выбор языка/runtime/фреймворка

### 2.1. Почему TypeScript на Node.js, а не Go / Python / Java / .NET / Ruby

| Стек                 | RPS          | Зрелость | AI-friendliness | РФ-найм | Вердикт                                                                                       |
| -------------------- | ------------ | -------- | --------------- | ------- | --------------------------------------------------------------------------------------------- |
| Node.js + TypeScript | средне       | ★★★      | ★★★             | ★★★     | **Выбран**                                                                                    |
| Java + Spring Boot   | высоко       | ★★★      | ★★              | ★★★     | Корпоративный overhead без выгоды                                                             |
| .NET + ASP.NET Core  | высоко       | ★★★      | ★★              | ★★      | Microsoft-привязка, в РФ найм ухудшается                                                      |
| Ruby on Rails        | низко        | ★★★      | ★★              | ★       | Найм в РФ 5-10× дороже Node, экосистема стагнирует                                            |
| Python + FastAPI     | средне-низко | ★★★      | ★★★             | ★★★     | Без typed end-to-end, GIL; AI-сервис на Python — да, основной API — нет                       |
| Go (Fiber/Gin)       | высоко       | ★★★      | ★★              | ★★      | AI хуже пишет; типы не текут в TS-фронт без codegen; runtime-speed не оправдан при упоре в БД |

**Решающие факторы:**

- Soft constraint из prep §"Soft constraints": TS/Python предпочтительнее Go/Rust для AI-генерации.
- 3 прототипа на Next.js + React → фронт де-факто TS → один язык на бэк/фронт = типы end-to-end без cross-language codegen.
- НМО, AI, миграция Directual, multi-tenant — I/O-bound нагрузка, не CPU-bound; runtime-преимущество Go не реализуется.

### 2.2. Почему NestJS, а не Hono / Fastify / Express / Koa

| Критерий                          | NestJS                        | Hono   | Fastify | Express    |
| --------------------------------- | ----------------------------- | ------ | ------- | ---------- |
| Готовая архитектура (DI, modules) | ✅                            | ❌     | ❌      | ❌         |
| Декларативный RBAC (guards)       | ✅                            | средне | средне  | руками     |
| OpenAPI генерация                 | ✅                            | ✅     | ✅      | руками     |
| WebSocket                         | ✅ (но используем Centrifugo) | ✅     | ✅      | плагин     |
| BullMQ интеграция                 | ✅ `@nestjs/bullmq`           | руками | руками  | руками     |
| Microservices (если понадобится)  | ✅                            | ❌     | ❌      | ❌         |
| Single-instance RPS               | 30-50k                        | 80k    | 70k     | 15k        |
| AI-агенты пишут паттерны          | ★★★                           | ★★     | ★★      | ★★★ legacy |

**Решающий фактор:** convention-over-configuration. AI-агент попадает в готовые рельсы (модуль → контроллер → сервис → guard → interceptor), что обеспечивает консистентность кода между сессиями/моделями. Hono/Fastify дают свободу, но требуют разработчика, который держит архитектуру в голове.

**Fastify-адаптер под NestJS** даёт +30-50% RPS относительно Express без изменения API NestJS — практически free upgrade.

### 2.3. Почему Zod, а не class-validator / TypeBox / Valibot

- **Single source of truth:** Zod-схема → TS-тип (`z.infer<>`) + runtime-валидация + OpenAPI (через `nestjs-zod-openapi`). Не требует дублирования.
- `class-validator` (классический NestJS) — требует отдельных DTO-классов с декораторами; типы не текут из validation в OpenAPI без ручного маппинга.
- `TypeBox` — JSON Schema-нативный, легче но менее ergonomic для composition; экосистема меньше.
- `Valibot` — современный, бандл меньше, но younger (меньше в LLM-датасете → AI пишет хуже).

### 2.4. Почему REST, а не GraphQL / tRPC / gRPC

| Стиль          | Вердикт                     | Причина                                                                                                             |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| REST + OpenAPI | **Выбран v1**               | Универсальный для Web/Mobile/Admin/integrations/webhooks; HTTP-кэш на CDN бесплатный; AI пишет лучше всего          |
| GraphQL        | Deferred v2 (триггер OQ2)   | Ломает CDN-кэш; rate-limit/security сложнее; webhooks всё равно REST → два стиля                                    |
| tRPC           | Отвергнуто                  | Только TS-клиенты; mobile native (Swift/Kotlin) или Flutter не работают; внешние интеграции — REST                  |
| gRPC           | Отвергнуто (для public API) | Браузер напрямую не умеет; mobile native — overkill; РФ-команд мало; для service-to-service — может вернуться (OQ4) |

**Триггер пересмотра GraphQL BFF (OQ2):** если на mobile появятся ≥3 толстых view-эндпоинта со сложной агрегацией и измеримой выгодой (трафик ≥30% или RTT ≥100ms на mobile 3G) — добавляется GraphQL **поверх** REST как BFF-слой, не вместо.

---

## 3. Архитектурная карта (паттерн, не frozen-список)

NestJS-приложение делится на модули. **Конкретный список модулей не замораживается в DSO-26**, так как функциональная карта может измениться к моменту разработки. Ниже — иллюстративный snapshot из PRD v1 на 2026-05-13.

### 3.1. Доменные модули (snapshot, revisable)

| Модуль                | Эндпоинт-домен             | Этап   | Что внутри                                                                                                         |
| --------------------- | -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `AuthModule`          | `/auth/*`                  | v1     | Login, refresh, logout, sessions, MFA. Тонкий слой над IdP (см. ADR-0001)                                          |
| `UsersModule`         | `/users/*`                 | v1     | Профиль, верификация медстатуса, мульти-роли. Mirror-table из IdP через outbox+reconcile                           |
| `CoursesModule`       | `/courses/*`, `/lessons/*` | v1     | CRUD курсов/уроков, прогресс, completion-события                                                                   |
| `LedgerModule`        | `/ledger/*`                | v1     | Append-only, антифрод-дедуп по `event_id`, баланс Con/Pul/Au                                                       |
| `NotificationsModule` | `/notifications/*`         | v1     | Очередь push/email/SMS, шаблоны, retry, failover SMS×2/email×2                                                     |
| `EventsModule`        | `/events/*`                | **v1** | Вебинары, очные мероприятия — критично для пилота                                                                  |
| `CertificatesModule`  | `/certificates/*`          | v2     | PDF-генерация ≤5s                                                                                                  |
| `SubscriptionsModule` | `/subscriptions/*`         | v2     | Донат-подписка, флаг `ad_free`                                                                                     |
| `AdsModule`           | `/ads/*`                   | v2     | Сервинг баннеров с маркировкой AIPM                                                                                |
| `ClinicsModule`       | `/clinics/*`               | v3     | DS Clinic, командные начисления                                                                                    |
| `AIPipelineModule`    | `/ai-pipeline/*`           | v3     | Async-контракт со status-polling; тонкий клиент к AI-runtime (DSO-30)                                              |
| `IntegrationsModule`  | `/integrations/webhooks/*` | v1     | Входящие webhook'и (платежи, видеохостинг, НМО) с verify-signature                                                 |
| `AdminModule`         | `/admin/*`                 | v1     | Привилегированные операции                                                                                         |
| `AnalyticsModule`     | `/analytics/*`             | v1     | Read-only агрегаты                                                                                                 |
| `ConsentModule`       | `/consents/*`              | **v1** | Фиксация согласий на обработку ПДн с версионированием; отзыв (ч.3 ст.9 152-ФЗ); экспорт согласий пользователя      |
| `ErasureModule`       | `/erasure/*`               | **v1** | Right-to-erasure flow (ст.21 152-ФЗ): запрос, верификация, async-выполнение с DAG зависимостей, отчёт пользователю |
| `PDNRegistryModule`   | internal                   | **v1** | ROPA-журнал: каждая операция над ПДн (read/write/export/erase) логируется отдельно от audit-log, retention 3+ года |

### 3.2. Сквозные модули (cross-cutting concerns)

| Модуль                | Тип                                   | Зачем                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RbacModule`          | Global guards + decorators            | Fine-grained + object-level permissions (ADR-0001 §1); guards вызывают **`IPolicyEngine` интерфейс** (определён в DSO-26 как часть RbacModule), с in-memory/SQL mock-реализацией. Конкретный engine (Cerbos / OPA / OpenFGA / SQL) выбирается в DSO-27 и подключается без изменения guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AuditModule`         | Два пути эмиссии (см. примечание)     | Append-only audit-лог 3 года; 23 auth-события + domain-события. **Auth- и security-события эмитятся явно в каждом месте команды** (порт `AuthAuditLog`; `auth/session/auth-audit.*`) — их субъекты/причины разнородны (login.success несёт sub+method; login.failure — маскированный identifier+reason и без субъекта; lockout срабатывает один раз на переходе; otp.sent — маскированный identifier и пока без субъекта), поэтому общий per-route interceptor не строит их единообразно. **Resource-routes с однородным субъектом** пишут терминальную access-строку через interceptor, управляемый `@Authz({ audit })`, который выводит строку из разрешённого субъекта запроса. Полнота — что ни одна state-changing auth-команда молча не пропустит свою терминальную строку — обеспечивается CI-guard'ом (тест покрытия эмиссии для high-stakes routes), а не interceptor'ом. |
| `TenancyModule`       | Global middleware + AsyncLocalStorage | Multi-tenant контекст (DS Clinic)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ThrottleModule`      | Global guard                          | Rate-limit per-user/IP/ASN; SMS budget circuit-breaker (ADR-0001 §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `HealthModule`        | `/healthz`, `/readyz`                 | K8s liveness/readiness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ObservabilityModule` | OpenTelemetry SDK                     | Trace/metric/log → Loki + Tempo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

#### 3.2.1. Mandatory NestJS middlewares (DSO-63 mini-L, 2026-05-18)

> **Forward-ref:** глобальный policy-enforcement guard `AuthzGuard` (`APP_GUARD`, читает `@Authz`-metadata каждого handler'а и fail-closed, если её нет) и CI-gate полноты `tools/lint-endpoint-authz` — см. **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`**.

Bootstrap NestJS app **должен** загружать следующие middlewares в фиксированном порядке (см. `apps/api/src/main.ts`):

| Middleware          | Зачем                                                                                                                                                                                                                                            | Конфиг                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fastify/raw-body` | Сохраняет raw byte buffer запроса до JSON parse — обязательно для **webhook signature verification** (Stripe, IdP webhooks, SMS provider callbacks). Без него signature check невозможен — JSON parse теряет точную byte representation.         | `app.register(fastifyRawBody, { field: 'rawBody', global: false, encoding: 'utf8' })`. Per-route opt-in через `RouteOptions.config.rawBody = true`. |
| `@fastify/helmet`   | Security headers baseline: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy. CSP profile-per-zone (per ADR-0001 §7) — на nginx-уровне, не в Node (per-zone discrimination требует HTTP routing context). Node helmet — base layer. | Default config + HSTS `max-age=31536000; includeSubDomains; preload`.                                                                               |
| `@fastify/compress` | gzip/br сжатие response body. Снижает egress bandwidth для JSON-ответов (API responses 5-100KB чаще всего).                                                                                                                                      | Default config, `global: true`, threshold 1KB.                                                                                                      |

**Где НЕ загружаются:**

- CSP headers — на nginx-уровне (zone-specific, см. frontend-stack-design §3.2 + ADR-0001 A1.2).
- TLS termination — на nginx или managed WAF (ADR-0001 §7 + DSO-63 #8 WAF selection).
- Rate limiting — `ThrottleModule` выше + edge WAF.

**Verification:** integration test `tests/middleware/baseline.test.ts` проверяет presence security headers + raw-body capture для test webhook endpoint.

### 3.3. Воркеры

> **Forward-ref:** имена очередей, payload-схемы, retry/DLQ/idempotency-политики, queue-job invariants — см. **`2026-05-18-ds-platform-bullmq-queue-contract-design`**. Ниже — только разнесение по worker-процессам.

**v1: два worker-процесса** (прагматика для команды 1-2):

| Worker (v1)            | Что обрабатывает                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifications-worker` | Очереди `push`, `email`, `sms` с retry и failover (отдельный процесс — критичная realtime-цепочка)                                                                                                                        |
| `generic-worker`       | Все остальные очереди как handlers внутри одного процесса: `ledger-events`, `pdf-generate`, `marketing-blast`, `ai-pipeline-result`, `webhooks:*`, `outbox`, cron-jobs (reconcile, ledger integrity, leaderboard refresh) |

**v2-v3: разделение по нагрузке**, когда метрики покажут необходимость:

- `ledger-worker` отдельно (если ledger становится hot-path).
- `pdf-worker` отдельно (CPU-heavy на сертификаты v2).
- `marketing-worker` отдельно (батч 10k≤10мин с троттлингом v2).
- `outbox-publisher` отдельно (если throughput требует).

Триггер выноса: queue depth p95 > 1000 за 1ч **или** worker CPU > 70% sustained.

### 3.4. Граничные сервисы (вне основного backend)

| Сервис     | Что                         | Зачем отдельно                              |
| ---------- | --------------------------- | ------------------------------------------- |
| Centrifugo | Realtime WS-шлюз (Go)       | Снимает с NestJS реалтайм-нагрузку          |
| AI runtime | DSO-30 (LangGraph / другое) | Изоляция AI-вызовов, PII-filter, разные SLA |

### 3.5. Ключевые архитектурные решения

1. **Монолит-first.** Логическая изоляция через модули, не через сетевые границы. Микросервисы — только при (а) разные SLA (Centrifugo, AI-runtime), (б) разные runtime-требования (CPU-heavy PDF-worker).
2. **Воркеры в том же кодбейзе** — один Docker image, разные команды запуска. Shared types.
3. **AI как тонкий клиент.** AIPipelineModule не знает о конкретном AI-стеке (LangGraph и т.д.) — видит только REST/queue-контракт.
4. **Centrifugo вне NestJS** — готовое решение для тысячи WS-коннектов.
5. **Outbox pattern для всех outgoing events** — атомарность БД-транзакции + публикации.

---

## 4. API-контракт

### 4.1. URL-структура

```
https://api.doctor.school/v1/<domain>/<resource>[/<id>][/<sub-resource>]
```

- Path-based versioning (`/v1/`, не header).
- Plural nouns для ресурсов.
- RPC-style endpoints допустимы для операций (`/auth/login`, `/transactions/:id/reverse`).

### 4.2. Pagination

**Cursor-based default** для всех list-эндпоинтов с потенциальным ростом >1000 элементов:

```
GET /v1/courses?cursor=eyJpZCI6...&limit=20

Response:
{
  "data": [...],
  "pagination": { "nextCursor": "...", "hasMore": true }
}
```

Offset допустим только для admin-таблиц с явной пагинацией страниц.

### 4.3. Error model — RFC 7807 Problem Details + расширения

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
- `detail` локализуется, `errorCode` — нет.
- Никаких stack-trace'ов в prod-ответе.

### 4.4. Idempotency

Все мутирующие endpoints принимают `Idempotency-Key: <uuid>` header. Backend хранит `(key, response)` 24h в Redis. Повтор — возвращает сохранённый ответ без побочных эффектов.

**Обязательно для:** ledger-транзакции, платежи, начисления, отправка SMS/email, создание ресурсов.

### 4.5. Authentication

- `Authorization: Bearer <jwt>` header.
- Web: JWT в `HttpOnly + Secure + SameSite=Lax + __Host-` cookie per app (ADR-0001 §6 + §7 — host-only per app, без shared cross-subdomain cookies; cross-app SSO через OIDC silent re-auth).
- Mobile: JWT в Keychain/Keystore, передаётся в header вручную.
- Two-tier validation (ADR-0001 §6): JWT fast-path для ≥99% запросов; `/introspect` для high-stakes (payments, AU withdrawal, role-change, admin mutations, PII export).

### 4.6. CSRF, CORS, rate-limit

- CSRF (Web): double-submit cookie token; (Mobile): не нужен.
- CORS: allowlist origin, не `*`.
- Rate-limit: per-user (5 login/15min, 100 API/15min), per-IP (20 login/15min, 1000 API/15min), per-ASN (100 login/h), SMS daily budget circuit-breaker ≤2000 (ADR-0001 §7).
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 4.7. OpenAPI и dev-tools

- Спека: `/v1/openapi.json`.
- UI: `/v1/docs` (Scalar или Swagger UI); на prod за admin-RBAC, на dev/staging — открыто.
- SDK: `@ds/api-client` (npm package в приватный реестр Verdaccio) генерируется в CI через `openapi-typescript`.

### 4.8. Минимальный пример endpoint

```ts
@Controller({ path: "courses", version: "1" })
export class CoursesController {
  @Get(":id")
  // `@Authz` — единая авторская поверхность для авторизации endpoint'а.
  // Через `applyDecorators` разворачивается в примитивы RbacModule —
  // ставит authz-metadata, которую читает глобальный `AuthzGuard`,
  // а matrix-генератор по той же metadata эмитит OpenAPI-расширение
  // `x-authz`. Одна аннотация, один SSOT. Для resource-routes с
  // однородным субъектом (как этот) поле `audit` также управляет
  // audit-interceptor'ом, который пишет терминальную access-строку из
  // разрешённого субъекта запроса. Auth- и security-события так НЕ
  // пишутся: они эмитятся явно в месте команды (§3.2 `AuditModule`), так
  // как их субъекты и причины разнородны (login.failure не имеет субъекта
  // и несёт маскированный identifier; lockout срабатывает один раз на
  // переходе) и не выводятся единообразно из ответа.
  // Полный контракт: endpoint-authorization-matrix-design.
  @Authz({
    access: "authenticated",
    roles: ["doctor_guest"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-30"], // covering scenario(s), по EARS id (иллюстративно)
  })
  @ApiOperation({ summary: "Get course" })
  async getOne(
    @Param("id", new ZodValidationPipe(z.string().uuid())) id: string,
  ): Promise<z.infer<typeof CourseSchema>> {
    return this.coursesService.findOne(id);
  }
}
```

Public (неаутентифицированные) entry points используют `@Public()` + `@Authz({ access: "public", check: "none", … })`: глобальный `AuthzGuard` пропускает аутентификацию, но handler всё равно несёт `@Authz`, чтобы попасть в matrix со своим audit-классом. Handler **без** `@Authz`-metadata отклоняется глобальным guard'ом (fail-closed) и роняет `endpoint-authz` CI gate.

---

## 5. Non-functional requirements

### 5.1. Performance budget (из digest §4)

| Метрика                 | v1         | v2         | v3         |
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

При превышении p95 на 5 минут подряд — алерт. PR с регрессией p95 ≥10% на staging — CI fail.

### 5.2. Обязательный чек-лист скорости (PR-blockers)

10 пунктов как архитектурные constraints, не recommendations:

1. **Primary DB под нагрузкой** (DB-выбор в DSO-27, рабочее предположение PostgreSQL): на каждый новый/изменённый SQL-запрос — `EXPLAIN ANALYZE` в PR-описании. Запрос >50ms → индекс или явное объяснение. **N+1 запросы запрещены** (линтер + query stats snapshot в CI).
2. **Redis cache:** read-heavy эндпоинты (профиль, баланс, лидерборд, каталог) — обязательно с кэшем (cache-aside, TTL ≤5 мин или invalidate по событию).
3. **CDN с RF-edge** (Timeweb CDN) для статики и медиа. Никакой статики через NestJS.
4. **Frontend оптимизация** (DSO-28): SSR/SSG, code-splitting, image-opt, prefetch. NestJS отдаёт только данные.
5. **Async-обязательность:** любая операция >100ms (PDF, email, SMS, AI, marketing, импорт) — в BullMQ, не в request-lifecycle.
6. **Видеопровайдер с RF-edge** (DSO-27) + адаптивный битрейт.
7. **Realtime gateway отдельный (Centrifugo)** — API не держит WS-нагрузку.
8. **Cursor-pagination** для всех list-эндпоинтов с потенциалом >1000 элементов.
9. **Materialized views** для агрегаций — **с v2** (на v1 10k MAU обычный SELECT+индекс справится; преждевременная оптимизация). Refresh асинхронно через scheduled job.
10. **Load-testing:** в **v1 — manual pre-release** (k6 запускается вручную на staging перед каждым релизом, baseline сохраняется); CI-gate на регрессию p95 ≥10% — **с v2** при наличии staging-mirror infrastructure.

### 5.3. CI guards

**v1 (minimal viable set, 4 ядерных гейта):**

| Гейт                  | Инструмент                                                                     | Что ловит                                                                                               |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Type check            | `tsc --noEmit`                                                                 | Type errors                                                                                             |
| Lint                  | eslint + `eslint-plugin-no-await-in-loop` + **custom no-class-validator rule** | `await` в цикле без `Promise.all`; запрет `@ApiProperty` / `class-validator` decorators (форсирует zod) |
| Tests                 | Vitest + supertest                                                             | Unit + integration; coverage warning <80%/60%                                                           |
| OpenAPI spec snapshot | `openapi-diff`                                                                 | Breaking changes без bump версии                                                                        |

**Дополнительные гейты — переезжают в v2** (при росте команды до 3+ человек):

| Гейт                                       | Зачем добавляется                   |
| ------------------------------------------ | ----------------------------------- |
| SQL query review (pg_stat_statements diff) | Новые медленные запросы             |
| Contract tests (Pact / OpenAPI snapshot)   | Поломка контракта на интеграциях    |
| Security scan (`npm audit` + Trivy)        | CVE                                 |
| k6 load-test selective                     | Регрессия p95                       |
| Docs symbol-existence (ts-morph)           | README ↔ код consistency            |
| TSDoc coverage                             | Public exports без docs             |
| Mermaid C4 render                          | Diagram-as-code валидность          |
| Cross-doc consistency                      | Spec ↔ ADR ↔ README не противоречат |

### 5.4. Observability (видно в Grafana с v1)

- RED-метрики per endpoint per HTTP method.
- Saturation: Postgres (connections, slow queries, replication lag), Redis (memory, evictions, hit rate), BullMQ (depth, processing rate, fails, DLQ size), Centrifugo (clients, channels, publish rate).
- Business metrics: Au-начисления/мин, regs/час, login success rate, payment success rate.

Через OpenTelemetry SDK → Loki + Tempo + Prometheus (engineering-readiness default).

### 5.5. Security baseline (наследуется из ADR-0001 §7 + backend-specific)

| Требование                               | Реализация                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate-limit per-user/IP/ASN               | `@nestjs/throttler` + Redis                                                                                                                                                                                                                                                                   |
| SMS budget circuit-breaker               | NotificationsModule                                                                                                                                                                                                                                                                           |
| CSRF protection                          | Cookie double-submit                                                                                                                                                                                                                                                                          |
| Input validation                         | Zod на всех endpoints (ZodValidationPipe global)                                                                                                                                                                                                                                              |
| SQL injection                            | Только через ORM + параметризованные запросы (ORM — DSO-27)                                                                                                                                                                                                                                   |
| XSS protection                           | JSON-only output, никакого HTML-rendering                                                                                                                                                                                                                                                     |
| Secrets                                  | `.env` + vault (engineering-readiness)                                                                                                                                                                                                                                                        |
| Audit log 3 года, append-only            | AuditModule                                                                                                                                                                                                                                                                                   |
| **ROPA-журнал (152-ФЗ требование)**      | `PDNRegistryModule` — отдельный append-only лог операций над ПДн (read/write/export/erase) с UUID, timestamp, actor, target subject, purpose. Не = audit-log (audit фиксирует action; ROPA фиксирует обработку ПДн)                                                                           |
| **Consent management (ч.3 ст.9 152-ФЗ)** | `ConsentModule` — версионированные согласия, отзыв, экспорт                                                                                                                                                                                                                                   |
| **Right-to-erasure (ст.21 152-ФЗ)**      | `ErasureModule` — async DAG удаления с верификацией                                                                                                                                                                                                                                           |
| PII в логах маскируется                  | OTel processor + custom redactor                                                                                                                                                                                                                                                              |
| **npm + Docker registry mirroring**      | Verdaccio (npm pull-through) + Harbor/Nexus (Docker mirror) — owner DSO-10. **Hard requirement v1**: без зеркал CI ломается при любой РФ-блокировке npm/Docker Hub                                                                                                                            |
| **Redis HA (sessions + idempotency)**    | **v1: single-node Redis + AOF + daily RDB snapshot** (ADR-0003 §8). Sessions хранятся в IdP (ADR-0001 §6), не в Redis. Idempotency keys — в Postgres (ADR-0003 §8). HA-триггер (Sentinel ≥3 узла) — >1000 active concurrent users ИЛИ >1 unplanned restart/мес (ADR-0003 §8 + ADR-0012 OQ-T2) |
| Helmet secure headers                    | `@nestjs/helmet`                                                                                                                                                                                                                                                                              |
| Webhook signature verify                 | IntegrationsModule, per-provider                                                                                                                                                                                                                                                              |
| TLS termination                          | На L7 LB (Timeweb / nginx), HSTS preload                                                                                                                                                                                                                                                      |
| Container security                       | Distroless, non-root, read-only FS                                                                                                                                                                                                                                                            |

### 5.6. Архитектурные качества (метрики, не декларации)

| Качество                                  | Метрика                                              | v1                                   | v2                 | v3            |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------ | ------------------ | ------------- |
| **Устойчивость при масштабировании**      | Horizontal scale-out factor                          | 10× за 1 час                         | —                  | 100× за 1 час |
| **Возможность смены стека (low lock-in)** | % бизнес-логики без NestJS-зависимостей              | ≥60%                                 | —                  | ≥80%          |
| **Надёжность под нагрузкой**              | Time-to-degradation при потере критичного провайдера | ≥15 мин                              | —                  | ≥30 мин       |
| **Recovery time**                         | RTO после primary DB failover                        | ≤2 ч (manual restore, ADR-0003 §2.4) | ≤5 мин (HA)        | ≤1 мин        |
| **Data integrity**                        | RPO (data loss window)                               | ≤15 мин (WAL gap, ADR-0003 §2.4)     | ≤5 мин             | ≤30 сек       |
| **Availability**                          | uptime SLO                                           | 99.0% (ADR-0002 §5.6)                | 99.5% (HA trigger) | 99.95%        |

**Дизайн-решения, обеспечивающие эти качества:**

| Качество               | Реализация в дизайне                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalability            | Stateless API, Redis-session, connection pooler (PgBouncer/equivalent — DSO-27), read-replicas (DSO-27), Centrifugo вне API, BullMQ workers независимы                                       |
| Stack portability      | REST/OpenAPI (клиенты не зависят от языка), ≥60% бизнес-логики в чистых сервисах без декораторов, ORM-абстракция, BullMQ через интерфейс, Zod-схемы переносимы в JSON Schema                 |
| Reliability under load | Circuit breakers для external (SMS, email, payment, AI), rate-limit, backpressure через очереди, timeout-budgets (5s default), graceful shutdown (≤30s), health checks, DLQ, идемпотентность |

### 5.7. Reliability сценарии

| Сценарий                                    | Защита                                                                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IdP недоступен                              | JWT fast-path продолжает работать ≥15 мин; login/refresh — graceful 503 + retry-after; алерт                                                                                                                                      |
| Primary DB down                             | Read-replica для read-only; write возвращает 503; failover ≤5 мин (v2 multi-AZ)                                                                                                                                                   |
| Redis down (v1 single-node)                 | Cache-bypass (degraded p95, re-fetch из Postgres); BullMQ non-critical jobs паузятся, критичные replay'ятся из Postgres outbox (ADR-0003 §8); sessions — без потерь (IdP-side); алерт. Восстановление из AOF + daily RDB snapshot |
| Redis down (v2+ HA, after Sentinel trigger) | **Redis Sentinel auto-failover** (≤30 сек), sessions — без потерь (IdP-side), кэш и BullMQ продолжают работать без degradation                                                                                                    |
| SMS provider #1 down                        | Auto-failover на #2                                                                                                                                                                                                               |
| Email provider #1 down                      | Auto-failover на #2                                                                                                                                                                                                               |
| Видеопровайдер down                         | Backup-провайдер если есть; graceful error; начисления приостановлены                                                                                                                                                             |
| AI runtime down                             | AI Pipeline jobs в очереди, retry; UI показывает "обрабатывается"                                                                                                                                                                 |
| NestJS-инстанс crash                        | LB удаляет, K8s/systemd рестарт; sticky-sessions нет → бесшовно                                                                                                                                                                   |
| Centrifugo down                             | Realtime обновления не приходят; UI fallback на polling 1×/30s                                                                                                                                                                    |

### 5.8. Capacity planning + infra footprint

| Этап         | MAU  | DAU  | Concurrent peak | API RPS peak | Infra footprint (Timeweb VPS)                                                                                                                                                                                                                                                                                                                                       | Est. monthly cost ₽                             | Realistic availability                                                  |
| ------------ | ---- | ---- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| v1 (Q1 2027) | 10k  | 1k   | 200             | ~50          | DS Platform prod (см. ADR-0012 §Process inventory): api-prod VPS = 1× API + 1× generic-worker + 1× notifications-worker + 1× Centrifugo + 1× nginx; data-prod VPS = 1× Postgres + **1× Redis 7 single-node** (HA trigger per ADR-0003 §8) + 1× pgbackrest sidecar. Shared shared-tooling VPS (DSO-10, отдельный budget): Verdaccio + Loki/Tempo/Prometheus + Vault. | **~20-30k ₽/мес** (см. ADR-0012 §Cost envelope) | **99.0% single-AZ** (ADR-0002 §5.6; HA внутри одного DC; cross-AZ — v2) |
| v2 (Q3 2027) | 100k | 10k  | 2k              | ~500         | 2× API + 2× workers (split: ledger + pdf + generic) + 2× Centrifugo + Redis cluster + Postgres primary + 2× read-replica + DWH                                                                                                                                                                                                                                      | ~80-120k ₽/мес                                  | 99.5% multi-AZ                                                          |
| v3 (Q1 2028) | 1M   | 100k | 20k             | ~5000        | 5+ API + 4+ workers (full split) + 4× Centrifugo + Redis cluster sharded + Postgres + ClickHouse DWH + полная инфра observability                                                                                                                                                                                                                                   | ~300-500k ₽/мес                                 | 99.95% multi-AZ                                                         |

**v1 availability target:** 99.0% single-AZ (ADR-0002 §5.6); 99.5% переносится в v2 при срабатывании OQ-D7 ADR-0003 (HA Postgres). Maintenance window 02:00–06:00 МСК исключён из SLO calculation. Полная топология prod-кластера — ADR-0012 «Deployment Topology v1».

k6 нагрузочные тесты — manual pre-release (v1), CI-gate с v2 при наличии staging-mirror.

**Centrifugo polling fallback overhead в capacity:** при падении Centrifugo 200 concurrent users × polling 1×/30s = +7 RPS на API. На v1 budget 50 RPS — 14% overhead, приемлемо. На v3 при 20k concurrent — +700 RPS = 14% overhead, тоже приемлемо.

---

## 6. Open questions и deferred решения

### 6.1. Делегировано в другие brainstorm'ы

| Вопрос                                          | Куда                                                               | Кандидаты для рассмотрения                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Primary DB                                      | DSO-27                                                             | **PostgreSQL 16** (рабочее предположение) / MySQL 8 / MariaDB / CockroachDB / Yugabyte / TiDB / EventStoreDB / Mongo    |
| ORM                                             | DSO-27                                                             | Prisma / Drizzle / Kysely / TypeORM / MikroORM                                                                          |
| Migrations                                      | DSO-27                                                             | Prisma migrate / Atlas / Flyway / pgroll                                                                                |
| Search engine                                   | DSO-27                                                             | Postgres FTS / Manticore / Meilisearch / OpenSearch                                                                     |
| Vector DB                                       | DSO-27 + DSO-30                                                    | pgvector / Qdrant / Weaviate                                                                                            |
| Cache layout                                    | DSO-27                                                             | Redis (предрешено) + namespace/eviction/TTL стратегия                                                                   |
| OLAP vs read-replica                            | DSO-27                                                             | Read-replica OLTP v1-v2 / ClickHouse / DWH v3                                                                           |
| Policy engine RBAC                              | DSO-27                                                             | Cerbos / OPA / OpenFGA / SQL-based                                                                                      |
| Frontend stack                                  | DSO-28                                                             | Next.js / Nuxt / SvelteKit / Astro / Remix                                                                              |
| Web-кабинетов разделение                        | DSO-28                                                             | One SPA с ролями vs N приложений                                                                                        |
| CMS промо-сайтов                                | DSO-28                                                             | Next.js / Tilda / Webflow / WordPress                                                                                   |
| Mobile stack                                    | DSO-29                                                             | Native / RN / Flutter / PWA / Capacitor                                                                                 |
| Local-first offline-sync                        | DSO-29                                                             | WatermelonDB / SQLite custom / PowerSync                                                                                |
| AI runtime                                      | DSO-30                                                             | LangGraph / CrewAI / Temporal+LLM / самописное                                                                          |
| LLM cost middleware                             | DSO-30                                                             | Portkey / Bifrost / Helicone                                                                                            |
| AI-провайдеры                                   | DSO-30                                                             | Anthropic / OpenAI / Yandex GPT / Sber GigaChat / Saiga2                                                                |
| Repo layout                                     | DSO-31                                                             | Turborepo / Nx / pnpm workspaces / polyrepo                                                                             |
| IdP                                             | Закрыто по ADR-0001 §8 (DSP-209)                                   | Zitadel                                                                                                                 |
| SMS provider РФ + failover                      | Отдельная задача                                                   | SMS.ru / SMSC.ru / Devino — **в РФ failover ручной (балансировка с разной семантикой), не Twilio-style auto**           |
| Email provider + failover                       | Отдельная задача                                                   | Mailgun / Postmark / Yandex.Postbox / RF-доступные альтернативы                                                         |
| Bot-protection                                  | Отдельная задача                                                   | Yandex SmartCaptcha (default)                                                                                           |
| **Deployment topology**                         | **Закрыто 2026-05-18 (DSO-53):** ADR-0012 «Deployment Topology v1» | 2-VPS docker-compose (api-prod + data-prod) + preview-vps; K3s / Nomad / Swarm / single-VPS / multi-VPS-LB rejected     |
| **npm + Docker registry mirroring**             | **DSO-10 (infra-readiness)**                                       | Verdaccio (pull-through proxy) + Harbor/Nexus (Docker mirror). Hard requirement v1                                      |
| **НМО / Росздравнадзор интеграция**             | **Отдельная задача (НЕ webhook)**                                  | Госсистема СМЭВ — XML, ГОСТ-подписи, отдельный модуль с возможной .NET/Java вставкой через очередь. Не webhook-receiver |
| **Sandbox-стратегия webhook signature testing** | Отдельная задача                                                   | Для платежей и видеохостинга — где брать sandbox-ключи, как тестировать на CI                                           |

### 6.2. Open questions внутри DSO-26 (могут потребовать update ADR)

| OQ                                                    | Триггер пересмотра                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ1. Bun как альтернативный runtime                   | Production-поддержка NestJS на Bun + успешные кейсы в РФ                                                                                                                       |
| OQ2. GraphQL BFF                                      | v2: ≥3 толстых mobile-view с трафик-выгодой ≥30% или RTT ≥100ms                                                                                                                |
| OQ3. Temporal для durable workflows                   | При появлении long-running flows (revenue share approval)                                                                                                                      |
| OQ4. gRPC для internal service-to-service             | При расхождении монолита на ≥3 сервиса с tight coupling                                                                                                                        |
| OQ5. Persisted queries / cached responses             | Если CDN-кэш недостаточен                                                                                                                                                      |
| OQ6. PDF-движок                                       | При реализации CertificatesModule v2 (puppeteer/playwright/LaTeX/typst)                                                                                                        |
| OQ7. Test coverage minimums                           | v2 review (стартуем 80% unit / 60% integration)                                                                                                                                |
| OQ8. Contract testing инструмент                      | Pact vs OpenAPI snapshot — при первой интеграции v1                                                                                                                            |
| **OQ9. AI скатывается на class-validator вместо zod** | Если eslint no-class-validator rule даёт >5 false-positives/неделю — пересмотреть подход; альтернатива — единый pre-commit hook конвертирующий class-validator → zod через AST |
| **OQ10. Deployment topology выбор**                   | **CLOSED 2026-05-18 (DSO-53)** — см. ADR-0012 «Deployment Topology v1».                                                                                                        |
| **OQ11. v1 availability target — 99.0% или 99.5%**    | **CLOSED 2026-05-18 (DSO-59)** — 99.0% v1 single-AZ per ADR-0002 §5.6; v2 HA trigger через OQ-D7 ADR-0003.                                                                     |

### 6.3. Risks и mitigations

| Риск                                      | Mitigation                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ |
| NestJS оверкилл для команды 1+2           | Стартуем с минимума модулей; AI-агенты компенсируют boilerplate    |
| Fastify-адаптер несовместим с плагинами   | Проверка на спайке Phase 0; fallback на Express (-30% RPS)         |
| Zod-OpenAPI — relatively recent ecosystem | Альтернатива `@nestjs/swagger` + class-validator в запасе          |
| Centrifugo экзотика в найме               | Документация на русском, low ops-burden, готовое решение           |
| BullMQ-jobs терятся при Redis crash       | Redis AOF persistence + outbox-source для критичных                |
| Performance budget оптимистичный          | k6 на staging до v1 release; буфер на оптимизацию                  |
| Документация расходится с кодом           | CI-gates symbol-existence-check + auto-gen где можно (Принцип 8.0) |
| Lock-in на NestJS                         | ≥60% бизнес-логики в чистых сервисах без декораторов               |

---

## 7. Realtime + Async backbone

### 7.1. Realtime push клиенту (Centrifugo)

**Архитектура:**

```
[Client]  ── WS ──▶  [Centrifugo]  ◀── publish HTTP ── [NestJS API]
                          ▲
                          │ JWT verify (HMAC shared secret)
```

- Клиент получает Centrifugo-токен от NestJS (`POST /v1/realtime/connect-token`), коннектится к Centrifugo.
- NestJS публикует через Centrifugo HTTP API: `POST /api/publish { channel: "user:<uuid>", data: {...} }`.
- Каналы: `user:<uuid>`, `webinar:<id>`, `leaderboard:global`.
- Centrifugo держит 50k+ коннектов на инстансе; presence, history, recovery — встроены.

**Когда WS внутри NestJS:** низкочастотные low-fanout сценарии (admin live-update, presence в чате поддержки) — допустимо.

### 7.2. Background jobs (BullMQ)

Гарантии:

- At-least-once + retry с экспоненциальным backoff (3, 9, 27, 81 сек).
- DLQ после 5 fail'ов → алерт в GlitchTip.
- Идемпотентность задач — на стороне worker'а (idempotency_key + Redis SETNX).
- Concurrency-limit per worker.

**Почему BullMQ, а не Temporal:** на Redis (уже есть), `@nestjs/bullmq` интегрирован в DI, нет 30-day workflows в нашем scope. Temporal — переоткроется при появлении long-running flows (OQ3).

### 7.3. Webhook ingress

```
1. Verify signature (HMAC / mTLS / IP allowlist — per provider)
   → Invalid: 401, лог в audit, никакого тела наружу
2. Quick acknowledge (200 OK) с пустым body немедленно
3. Enqueue в `webhooks:<provider>` очередь
4. Дальнейшая обработка — в worker'е (retry, idempotency)
```

### 7.4. Outbox pattern для исходящих событий

```sql
BEGIN;
  INSERT INTO domain_events (id, type, payload, ...) VALUES (...);
  -- бизнес-логика
COMMIT;
```

Отдельный `outbox-publisher` процесс (в `generic-worker` для v1):

```
LOOP:
  BEGIN;
  SELECT id, type, payload FROM domain_events
    WHERE published_at IS NULL
    ORDER BY id
    LIMIT 100
    FOR UPDATE SKIP LOCKED;   -- защита от race при parallel-instance
  для каждого:
    publish в Centrifugo / BullMQ / webhook
    UPDATE published_at = now() WHERE id = ...
  COMMIT;
```

Решает dual-write проблему: событие публикуется тогда и только тогда, когда транзакция закоммичена.

**Важно — at-least-once гарантия:** outbox-publisher может умереть после publish, но до UPDATE → событие будет переотправлено при следующем цикле. Поэтому **все consumer'ы должны быть идемпотентны по `event_id` (UUID из domain_events.id):**

| Consumer                                | Idempotency mechanism                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ledger-worker`                         | INSERT ledger_transactions с UNIQUE (event_id), ON CONFLICT DO NOTHING                              |
| `notifications-worker` (push/email/SMS) | Redis SET NX `sent:<event_id>:<channel>` TTL 7d перед отправкой                                     |
| Centrifugo publish                      | Centrifugo idempotency через message-id header; клиент дедуплицирует на основе event_id в payload   |
| Webhook outgoing                        | HMAC-подписанный payload содержит event_id; receiver обязан быть идемпотентным (часть webhook-spec) |
| `marketing-worker`                      | INSERT marketing_blast_recipients с UNIQUE (blast_id, user_id)                                      |
| `ai-callback-worker`                    | UNIQUE (event_id) на ai_pipeline_results table                                                      |
| `reconcile-worker` (cron)               | UPSERT pattern; cron-jobs by definition идемпотентны                                                |

**Запрет:** ни один consumer не может полагаться на "outbox-publisher отправит ровно один раз". Это контракт уровня spec.

### 7.5. Scheduled jobs

| Задача                     | Расписание     | Действие                                  |
| -------------------------- | -------------- | ----------------------------------------- |
| Курс золота Мосбиржи       | `0 9 * * *`    | Pull курса                                |
| Reconcile users-mirror     | `*/10 * * * *` | Сверка с IdP                              |
| Ledger integrity check     | `0 3 * * *`    | Hash-chain validation, алерт при mismatch |
| Aggregate leaderboard (v2) | `*/15 * * * *` | Refresh materialized view                 |
| Cleanup idempotency keys   | `0 * * * *`    | Очистка Redis                             |
| Streak push trigger (v3)   | `0 19 * * *`   | Push врачам с угрозой разрыва             |

Cron работает в одном worker-инстансе через `@nestjs/schedule` + Redis-lock.

### 7.6. Карта потоков (пример: завершение урока)

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

API-ответ — сразу после COMMIT. Через ~200ms прилетает push "+5 Au".

---

## 8. Documentation workflow

### 8.0. Главный принцип: Docs as SSOT

Документация — единый источник правды для разработки, не побочный продукт. Линза для всего раздела 8.

1. **Doc-first cycle, не code-first:** brainstorm → spec → ADR → Module README → код. PR с кодом без обновления доки не мержится.
2. **AI-сессия начинается с доки**, не с git history. Module README + ADR — первое действие.
3. **Доки не противоречат коду — by construction:**

- OpenAPI генерируется из Zod-схем (не пишется руками).
- TypeDoc — из TSDoc.
- Compodoc — из NestJS-метаданных.
- Module README ссылается на конкретные символы → CI проверяет существование через AST.

4. **Доки не противоречат друг другу.** Spec ↔ ADR ↔ README cross-doc consistency — CI-гейт.
5. **Доки используются операционно.** Раздел без читателя удаляется. Тест: даёт ответ за 30 сек?
6. **Knowledge base = читаемый агрегат.** Notion — то же содержимое, что в репо, не "адаптированная версия".
7. **CI — единственный механизм enforcement.**
8. **Workflow в CLAUDE.md:** после имплементации DSO-26 — правило "при работе с модулем сначала прочитать README + ADR".

### 8.1. Слои документации

**v1 (minimal, для команды 1-2 + AI):**

| Слой               | Где                                      | Кто пишет               | Когда                |
| ------------------ | ---------------------------------------- | ----------------------- | -------------------- |
| Specs (дизайн)     | `docs/superpowers/specs/YYYY-MM-DD-*.md` | Brainstorm → человек/AI | ДО кода              |
| ADR                | `docs/adr/NNNN-*.md`                     | После brainstorm        | ДО кода              |
| API docs (OpenAPI) | `/v1/openapi.json` + Scalar UI           | **Auto из Zod**         | Каждый build         |
| Module READMEs     | `src/<module>/README.md`                 | Разработчик/AI с кодом  | В PR (manual review) |
| Runbooks           | `docs/runbooks/<scenario>.md`            | Разработчик             | На новый сценарий    |
| Knowledge base     | Fumadocs-портал (`apps/docs`)            | Репо — SSOT (ADR-0006)  | Merge в main         |

**v2 (при росте команды до 3+):**

| Слой                        | Зачем добавляется                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------- |
| TSDoc inline + TypeDoc HTML | Когда public API >50 экспортов и onboarding новых разработчиков становится регулярным |
| Compodoc                    | NestJS-граф модулей                                                                   |
| C4 Mermaid                  | Архитектурные диаграммы as code                                                       |
| Docusaurus site             | Единый портал документации                                                            |

### 8.2. Шаблон Module README

```markdown
# <ModuleName>

**Назначение:** одна фраза.

## When to read this README

- Перед изменением public API модуля.
- При первой работе с модулем (новая сессия / новый разработчик).

## Public API

- `POST /v1/courses` — создать курс [role: admin, expert]
- ...

## Внутренние сервисы

- `CoursesService.findOne(id)` — с кэшем (Redis, TTL 5 мин)
- ...

## Зависимости

- `UsersModule`, `LedgerModule`, `StorageModule`

## Алгоритмы и инварианты

1. Курс не удаляется, если >0 пройденных уроков (soft-delete only).
2. ...

## События (domain events, через outbox)

- `CourseCreated { id, authorId, ... }`
- ...

## Конфигурация (env)

- `COURSES_PREVIEW_MAX_SIZE_MB=10`

## Open questions

- Plane DSO-XX
```

### 8.3. Auto-generated артефакты

- **OpenAPI → Scalar UI**: Zod → OpenAPI 3.1 → Scalar UI на `/v1/docs`; HTML-snapshot на `https://docs.doctor.school/api/v1/`.
- **TypeDoc**: TSDoc → static-site `https://docs.doctor.school/typedoc/`.
- **Compodoc**: NestJS-граф модулей → SVG; coverage документации → `https://docs.doctor.school/compodoc/`.
- **Mermaid C4**: System Context / Container / Component диаграммы в markdown.

### 8.4. Docs-first workflow

```
1. Brainstorm-сессия (skill /brainstorming)
2. Spec в docs/superpowers/specs/
3. Approve спеки человеком
4. ADR в docs/adr/ (если архитектурное решение)
5. Spec + ADR commits в main (отдельный PR от кода)
6. Имплементация:
   a. Module README с public API + алгоритмами
   b. Zod-схемы (контракт)
   c. TDD: тесты по контракту
   d. Код с TSDoc
   e. Обновить C4 если структурные изменения
7. PR с кодом → CI:
   - 10 NFR-чек-пойнтов (§5.2)
   - Docs: README обновлён, OpenAPI валидна, TSDoc coverage не упал
   - Contract-tests
8. Merge → CI публикует:
   - `@ds/api-client` новая версия
   - Обновлённый Scalar UI / TypeDoc / Compodoc
   - Sync специй + ADR + Module READMEs в Notion
```

### 8.5. CI documentation gates

**v1 (4 ядерных, PR-blockers):**

| Гейт                   | Что проверяет                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| openapi-snapshot       | Breaking changes требуют bump версии                                                                                                |
| module-readme-required | PR трогает `src/<module>/*.controller.ts`/`*.service.ts` → README в diff (или override label) — **manual review, не machine check** |
| adr-link-check         | Markdown-ссылки в specs/ADR валидны                                                                                                 |
| spec-frontmatter       | Корректные frontmatter (date, status, related-issues)                                                                               |

**v2 (при росте команды до 3+):**

| Гейт                                  | Когда добавляется                              |
| ------------------------------------- | ---------------------------------------------- |
| symbol-existence-check (ts-morph AST) | README рост: когда стало >20 модулей с readmes |
| tsdoc-coverage                        | После добавления TypeDoc слоя                  |
| c4-diagram-render                     | После добавления C4 Mermaid                    |
| cross-doc-consistency                 | После роста ADR-corpus до 15+                  |

### 8.6. Knowledge base

SSOT документации и публикация определены в ADR-0006 (Documentation & SSOT): репозиторий — единственный источник правды, рендерится Fumadocs-порталом (`apps/docs`). Внешней синхронизации knowledge base нет.

### 8.7. Тулинг

**Точные имена npm-пакетов (фиксируем во избежание confusion):**

- **`nestjs-zod`** (https://github.com/risenforces/nestjs-zod) — основная библиотека интеграции Zod в NestJS. Включает `ZodValidationPipe`, `ZodValidationException`, `createZodDto`, и интеграцию с `@nestjs/swagger` для OpenAPI генерации.
- НЕ `nestjs-zod-openapi` (это другой, менее распространённый пакет — не используем).
- НЕ `@anatine/zod-nestjs` (другая ниша, для standalone Zod без NestJS-обёртки).

**v1 tooling:**

| Инструмент                       | Что                                    |
| -------------------------------- | -------------------------------------- |
| `nestjs-zod` + `@nestjs/swagger` | OpenAPI 3.1 из Zod-схем                |
| Scalar API Reference             | API browser (modern, лучше Swagger UI) |
| `openapi-typescript`             | SDK генерация для клиентов             |
| `markdown-link-check`            | CI link checking                       |
| GitHub Action + Notion API       | Sync в knowledge base                  |

**v2 tooling (добавляется при росте):**

| Инструмент            | Когда                           |
| --------------------- | ------------------------------- |
| TypeDoc               | После роста TSDoc-покрытия      |
| Compodoc              | NestJS-граф при росте модулей   |
| Mermaid + C4 plantuml | Архитектурные диаграммы as code |
| Docusaurus            | Единый портал                   |
| `ts-morph`            | AST-проверки symbol-existence   |

Все open-source, self-hosted-friendly.

---

## 9. Decisions summary

| Решение              | Выбор                                                |
| -------------------- | ---------------------------------------------------- |
| Runtime              | Node.js 22 LTS                                       |
| Язык                 | TypeScript 5.6+ strict                               |
| Framework            | NestJS 11 + Fastify-адаптер                          |
| Валидация            | Zod через `nestjs-zod` (single source of truth)      |
| API style v1         | REST + OpenAPI 3.1                                   |
| SDK                  | `openapi-typescript` codegen                         |
| Async-очередь        | BullMQ + `@nestjs/bullmq`                            |
| Scheduled jobs       | `@nestjs/schedule` + Redis-lock                      |
| Realtime gateway     | Centrifugo (внешний Go-сервис)                       |
| Object storage + CDN | Timeweb Object Storage + Timeweb CDN                 |
| Pagination           | Cursor-based default                                 |
| Error model          | RFC 7807 Problem Details + `errorCode`/`traceId`     |
| Idempotency          | `Idempotency-Key` обязательно для мутаций, 24h Redis |
| URL versioning       | Path-based `/v1/...`                                 |
| Auth                 | Bearer JWT, two-tier validation (ADR-0001)           |
| Testing              | Vitest + supertest                                   |
| Package manager      | pnpm 9                                               |
| Container            | Distroless, non-root, read-only FS                   |
| Documentation        | Docs-as-SSOT, doc-first, auto-gen, CI-gates          |

---

## 10. Что разблокирует DSO-26

После принятия этого spec и ADR-0002 разблокируются brainstorm'ы:

- **DSO-27** (Data layer) — теперь можно выбирать ORM/migrations/search/cache/policy-engine с учётом TS-стека.
- **DSO-28** (Frontend) — backend SDK будет `@ds/api-client` (openapi-typescript), фронт может рассчитывать на типизированный fetch-клиент.
- **DSO-29** (Mobile) — выбор cross-platform/native с учётом, что backend REST + OpenAPI работает с любым клиентом.
- **DSO-30** (AI runtime) — будет отдельный сервис с REST/queue-контрактом к NestJS, без жёсткой привязки к Node.
- **DSO-31** (Repo layout) — теперь известны компоненты, можно проектировать monorepo vs polyrepo.

---

## Приложение A — Ссылки

- ADR-0001: `apps/docs/content/adr/0001-identity-provider-shortlist-ru.md`
- ADR-0002: `apps/docs/content/adr/0002-backend-core-stack-ru.md` (этот brainstorm)
- Identity spec: `apps/docs/content/adr/0001-identity-provider-shortlist-design-ru.md`
- Tech requirements digest: `outputs/2026-05-12-ds-platform-tech-requirements-digest.md`
- Brainstorm prep: `outputs/2026-05-12-tech-stack-brainstorm-prep.md`
- Engineering readiness: `docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-ru.md`
- Infra cost research: `outputs/2026-05-07-infra-cost-research-revised-ai-outside-rf.md`
- AI-agent dev readiness: `outputs/2026-05-12-ai-agent-dev-readiness-research.md`
- PRD v1: `knowledge-base/documents/Doctor-School-Platform-PRD-v1.md`
- Component spec backend: `knowledge-base/documents/ds-platform-components/01-backend.md`
