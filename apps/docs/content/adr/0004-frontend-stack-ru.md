---
title: "ADR-0004 — Frontend Stack для DS Platform [RU]"
description: "DS Platform — 6 веб-поверхностей с разными жанрами:"
lang: ru
---

> **EN:** [`0004-frontend-stack-en.md`](./0004-frontend-stack-en.md) · **RU (this)**

# ADR-0004 — Frontend Stack для DS Platform

**Дата:** 2026-05-14
**Статус:** Accepted
**Связан с:** Plane DSO-28 (`b9b950e8-6ad2-4e50-807d-f7e74aaeed5a`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0004-frontend-stack-design-ru.md`
**Наследует:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend core: NestJS+TS+Zod+REST+Centrifugo+BullMQ+Timeweb storage), ADR-0003 (Postgres17+Drizzle+Cerbos+Redis, single Postgres instance)

---

## Context

DS Platform — 6 веб-поверхностей с разными жанрами:

- Промо-страницы (#21) — SEO-public, маркетинг-контент
- Web-кабинет врача (#17) — mobile-first auth, документы + вебинар
- Кабинет эксперта (#18) — CMS-редактор курсов
- Кабинет клиники (#19, v3) — игровая карта + dashboard
- Кабинет инвестора (#20) — маркетплейс рекламы + ROI dashboard (главный revenue source бизнеса)
- Admin/CMS (#14) — модерация, верификация медстатуса, выдача ДПО, AI pipeline UI

Constraints:

- 152-ФЗ — hosting в РФ, ПДн не покидают РФ
- Self-host РФ — никаких Vercel/Cloudflare/AWS managed services
- AI-агенты — основной механизм разработки (объективные критерии AI-friendliness: размер LLM-датасета, mainstream-статус)
- Эксплуатация командой 1-2 человек, AI-first dev
- Multi-role user (доктор → эксперт → клиника-сотрудник)
- ADR-0001 §7 требует CSP profile-per-zone (admin как top-tier security perimeter)
- ADR-0002 §5 фиксирует `openapi-typescript` codegen → один SDK для frontend
- ADR-0002 §7 фиксирует Centrifugo как realtime gateway
- ADR-0003 §1 фиксирует один Postgres-instance

[[feedback_tech_stack_criteria_no_team_skill]] — запрет на «команда умеет X», «прототипы на Y», «hiring-pool в РФ» как pro-аргументы. Только intrinsic criteria.

---

## Decision

### 1. Meta-framework: **Next.js 15 App Router + RSC**

Один framework на все 6 поверхностей. Объективно выигрывает по совокупности High-весовых критериев (+51 vs +36 ближайший конкурент Split-toolchain): максимальный LLM-датасет среди React-meta-frameworks, RSC даёт SSR-shell + client-hydration + HttpOnly cookie на сервере из коробки, RF-self-host без Vercel-зависимости (standalone build).

Запрет: `@vercel/*` packages, Edge Runtime с Vercel KV, Vercel Image Optimization, Vercel Cron, Vercel Analytics. ESLint rule `no-vercel-only-api` enforce.

### 2. App-split: **4 Next.js apps**

```
apps/promo/    # SSG/ISR, doctor.school
apps/portal/   # SSR auth + client-hydration, app.doctor.school
apps/admin/    # Refine + 2FA, admin.doctor.school
apps/cms/      # Payload v3 inside Next.js, cms.doctor.school
```

Cookies: **host-only `__Host-` cookie per app** (`__Host-ds_portal_session`, `__Host-ds_admin_session`, `__Host-ds_cms_session`, etc.). Cross-app SSO continuity — через OIDC silent re-auth (`prompt=none`) у IdP, не через shared cookie на `.doctor.school`. Single source of truth: ADR-0001 §6.

Deployment v1-v2: один VPS "frontend-prod" + 4 Docker контейнера + nginx reverse-proxy. v3+ trigger — split при 1M MAU.

### 3. Admin framework: **Refine** + custom data/auth/access providers → NestJS+Cerbos+Authentik

Refine — admin-UI framework над **существующим backend** (ADR-0002 NestJS). Не headless CMS (это дублировало бы backend). UI-agnostic — нативно работает с shadcn/ui (наша design-system).

Custom provider'ы:

- Data provider (~100 строк) → NestJS REST API (cursor-pagination, RFC 7807, Idempotency-Key)
- Auth provider (~50 строк) → Authentik/Zitadel JWT
- Access provider (~50-100 строк) → custom adapter поверх `@cerbos/embedded` SDK. Cerbos — **документированный community pattern** в Refine docs, не packaged `@refinedev/cerbos`. Adapter локальный (наследие ADR-0003 §5).

### 4. Design-system: **Tailwind CSS 4 + shadcn/ui + lucide-react** (общий `packages/design-system`)

RSC-native (static CSS, никаких runtime CSS-in-JS workaround'ов), maximum LLM-датасет, owned-code customization (shadcn копирует компоненты в репо, не npm-dependency). Поверх — TipTap (rich-text), Tanstack Table, react-day-picker, Recharts/Tremor (charts).

User cabinets в `apps/portal` — custom React (не Refine), brand-UX требует кастомных flows.

### 5. Data-fetching: **Tanstack Query v5 + RSC hybrid + Server Actions точечно**

Pattern: RSC даёт initial SSR с данными → `HydrationBoundary` сериализует state на клиент → Tanstack Query handles client interactivity + cache + invalidation. Centrifugo WS-события вызывают `queryClient.invalidateQueries`. Server Actions — для simple admin-mutations без client-cache.

Tanstack Query — единый pattern на всех 4 apps (Refine построен на TQ внутри). **Caveat:** Refine в `apps/admin` управляет собственным `QueryClient` (Refine — client-side framework); admin app effectively CSR с тонким SSR-shell. `HydrationBoundary` применим в portal/promo/cms, не для Refine-managed resources в admin. См. design spec §4, §5, §8.1.

### 6. Forms: **RHF + `zodResolver` + shadcn `<Form>`**

shadcn `<Form>` примитив **построен на RHF**. Refine официально использует RHF. Zod-схема — один SSOT в `packages/api-client/schemas/` (NestJS backend и frontend импортируют тот же файл).

### 7. Promo content source: **Payload CMS v3 content-only**

Payload v3 живёт inside Next.js в `apps/cms`. Owns только marketing-content tables (`cms.*` schema namespace в shared Postgres из ADR-0003). НЕ trogue domain data (domain → NestJS+Drizzle через `public.*`).

SSOT enforcement через custom Lexical features («Insert glossary term» button в rich-text toolbar → relation reference, не литерал) + CI-lint на canonical terms. Custom Auth Strategy → Authentik/Zitadel. MCP server для AI-агентов.

### 8. Image optimization: **гибрид**

- Promo SSG → Next.js static imports → build-time variants → CDN cache как статика
- Portal/Admin dynamic → `next/image` Sharp on Node + Timeweb CDN cache
- Payload media library → Payload's встроенный Sharp pipeline → Timeweb Object Storage → CDN serve

Один delivery layer — Timeweb CDN. Trigger: OQ-F10 (imgproxy при Node CPU >70%). Variant «Timeweb CDN native transforms» снят с рассмотрения — feature не существует на Timeweb (подтверждено 2026-05-14).

### 9. Real-time client: **`centrifuge-js`** + кастомные React hooks в `packages/api-client`

Из ADR-0002 §7. Hook `useCentrifugoChannel` оборачивает Centrifuge subscription + `queryClient.invalidateQueries` по publish-событиям.

### 10. i18n: **`next-intl`**

App Router-native, RSC-compatible, TS-typed message keys. Messages в `messages/ru.json` каждого app + общие в `packages/i18n-shared/`. i18n-ready с v1, multi-lang в v2+.

### 11. Testing: **Vitest + React Testing Library + Playwright**

Vitest (unit + integration) + RTL (component) + Playwright (E2E cross-browser).

### 12. PWA: **`serwist`** (поддерживаемый next-pwa fork) — installable manifest + service-worker

В `apps/portal`. Offline-чтение уроков — OQ-F7 (defer v2+, зависит DSO-29).

### 13. Lint/Format: **ESLint flat config + Prettier + plugin-tailwindcss**

Custom rules: `no-class-validator` (наследие ADR-0002 §3), `no-vercel-only-api`, `glossary-required` (для marketing content).

### 14. Monorepo: **pnpm workspaces + Turborepo**

Базовый layout (apps/ + packages/) зафиксирован в design spec §17. Финальный — DSO-31.

### 15. Observability frontend: **GlitchTip** (self-hosted, Sentry API-compatible) + `@sentry/nextjs` SDK + Web Vitals tracking

GlitchTip MIT, self-host, RF-compliant. SDK официальный Sentry — LLM-датасет максимальный.

---

## Consequences

### Положительные

- AI-агенты пишут идиоматичный React с первой попытки (все выбранные библиотеки — mainstream с максимальными LLM-датасетами).
- Один meta-framework на 4 apps → один mental model, один build/deploy pattern, один CI-pipeline шаблон.
- 4 apps дают independent deploy cadence + изолированные security perimeters (admin/cms 2FA-zone, portal/promo SSO-zone) + AI focused на одном app за раз.
- Type-safety end-to-end: Zod-схемы из `packages/api-client/schemas/` текут от NestJS validation через RHF forms до RSC fetches без cross-language codegen.
- RSC + Tanstack Query гибрид даёт лучшее из обоих миров — server-fetch с HttpOnly cookie + client interactivity + real-time invalidation.
- Payload content-only решает SSOT-дисциплину для маркетинг-контента (glossary inline references в rich-text) без overhead полного headless CMS на backend.
- Refine + Cerbos integration наследует policy engine из ADR-0003 — admin permissions использует те же `*.yaml` policies что NestJS guards.
- Sharp + Timeweb CDN hybrid даёт зерo runtime CPU для promo (build-time) и кэшируемые transforms для dynamic (Node-CPU только на cold cache).

**Inheritance caveat (для transparency):** ADR-0004 derives end-to-end TypeScript typing benefit от ADR-0002's выбора Node.js+TS runtime. ADR-0002 §1 содержит argumentation с упоминанием существующих прототипов («3 прототипа на Next.js») и hiring-pool в РФ — это нарушает правило [[feedback_tech_stack_criteria_no_team_skill]] которое позже сформулировалось в этом ADR. Это не invalidates выбор Next.js здесь (он стоит на objective criteria — LLM-датасет, UI-экосистема, RSC), но при будущей ревизии ADR-0002 Node.js choice должен быть verifiable на objective grounds independently. Если ADR-0002 будет revisited без «3 прототипа» — Node.js всё равно должен пройти по чистым критериям, иначе ADR-0004 inherited TS-end-to-end benefit под вопросом.

- Self-host stack полностью — никаких Vercel/Cloudflare/AWS зависимостей; 152-ФЗ-compliant из коробки.

### Отрицательные

- Vercel-bias в Next.js DX/docs требует дисциплины (ESLint rule + явный список запрещённого + review).
- Payload содержит свою migration-систему рядом с Drizzle (две migration-tool в codebase, оба в monorepo). **Namespace separation `cms.*` vs `public.*` — недостаточно как security/operational boundary**, это только naming convention. Mitigation — **Postgres role-level privilege separation**: `cms_owner` имеет USAGE only на `cms.*` schema, `app_owner` only на `public.*`. Это enforce'ится на уровне Postgres roles, не conventions. См. design spec §10.2.1 (амендмент к ADR-0003 §1 — multi-role privilege).
- Payload integration с Authentik требует custom Auth Strategy ~50 строк. Не trivial, но прямой pattern.
- Один VPS на 4 frontend-контейнера v1-v2 — single point of failure для всего frontend. SLO 99.0% v1 это допускает. v3 — split.
- **Composite end-to-end SLO v1 ≈ 98.0%** (frontend 99.0% × backend 99.0% из ADR-0002), не сумма индивидуальных. Это материально хуже декларируемых отдельных SLO. Mitigation v1: Docker `restart: always` + watchdog alerts + manual failover SOP (DSO-10). v2/v3 — active-passive HA или multi-VPS split.
- **Webinar 10k concurrent failure scenario**: при падении frontend-prod VPS во время live-вебинара все 10k zрителей теряют web (независимо от Centrifugo health). Mitigation v1: pre-warmed cold-standby snapshot, manual failover ≤15 мин.
- Refine + custom data provider требует tests для contract между NestJS API и Refine queries — добавочный testing surface.
- Custom Lexical features для Payload glossary insertion — non-trivial разработка (~3-5 дней Phase 0).

### Архитектурные качества (метрики, не декларации)

| Качество             | Метрика               | v1                      | v3     |
| -------------------- | --------------------- | ----------------------- | ------ |
| Bundle size (portal) | gzipped JS на главной | ≤200KB                  | ≤300KB |
| LCP (promo)          | Mobile, throttled 3G  | ≤2.5s                   | ≤2.0s  |
| PageSpeed (promo)    | Mobile score          | ≥80                     | ≥90    |
| TTI (portal главная) | Mobile                | ≤3.5s                   | ≤2.5s  |
| Deploy frequency     | Independent apps      | 4 independent pipelines | Same   |
| Web Vitals INP       | p75                   | ≤200ms                  | ≤100ms |
| Cold start (Node)    | Per-container         | ≤2s                     | ≤1s    |

---

## Open questions (deferred)

| OQ                                       | Триггер пересмотра                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-F1. Миграция promo на Astro           | Маркетинг ≥3 разработчиков, PageSpeed промо <90 mobile, demand на visual-CMS workflow                                                                                                                                                                         |
| OQ-F2. Portal split на multiple apps     | Portal-bundle >500KB gzipped, expert-CMS отдельный threat model                                                                                                                                                                                               |
| OQ-F3. Scaling топологии v3              | 1M MAU достигнут, или Centrifugo+SSR на одном VPS bottleneck                                                                                                                                                                                                  |
| OQ-F4. Migration Payload → Keystatic     | Маркетинг scope сужается до 3-5 лендингов И inline-glossary не нужен                                                                                                                                                                                          |
| OQ-F5. Auth perimeter cms vs admin merge | Threat models сливаются (sейчас раздельны: маркетинг ≠ модераторы)                                                                                                                                                                                            |
| ~~OQ-F6~~                                | ~~Timeweb CDN native image transforms~~ — закрыт 2026-05-14: feature не существует у Timeweb CDN                                                                                                                                                              |
| OQ-F7. Offline-уроки в PWA web           | DSO-29 mobile sync-strategy фиксирует pattern; web подхватывает                                                                                                                                                                                               |
| OQ-F8. Migration на Biome                | ESLint CI >5 минут/PR, Prettier-плагин ecosystem отстаёт                                                                                                                                                                                                      |
| OQ-F9. Storybook для design-system       | Команда ≥2 frontend, design-system >20 компонентов                                                                                                                                                                                                            |
| OQ-F10. imgproxy для image-CPU           | Node CPU >70% в peak, Sharp p99 >500ms                                                                                                                                                                                                                        |
| OQ-F11. Self-hosted Plausible Analytics  | v2+ marketing analytics с RF-residency                                                                                                                                                                                                                        |
| OQ-F12. Payload native auth fallback     | DSO-25 spike (Authentik vs Zitadel) показал, что headless API не поддерживает clean custom-strategy для Payload v3. Consequence: Payload native auth + email-mirror через webhook outbox; SSO между cms и portal/admin ломается (отдельный логин маркетолога) |

## Делегировано

- **Mobile stack** — DSO-29 (отдельная brainstorm-сессия).
- **AI runtime / LLM middleware** — DSO-30.
- **Repo strategy formal** (финальный monorepo layout, CI/CD, versioning) — DSO-31. Базовая конвенция здесь — минимум.
- **Frontend-VPS provisioning + nginx vhost + TLS-certs** — DSO-10 (infra readiness).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation после DSO-25 IdP-spike.
- **Конкретные UX-flows для каждого кабинета** — product-задачи, не tech-decision.
- **Game-map UI для DS Clinic (#19, v3)** — отдельный design spec ближе к v3.

## Связанные ADR

- ADR-0001 — Identity/Auth/RBAC (cookie-стратегия, JWT с two-tier validation, hybrid RBAC)
- ADR-0002 — Backend Core (NestJS API + Zod SSOT + Centrifugo + BullMQ + Timeweb storage; `openapi-typescript` codegen → SDK)
- ADR-0003 — Data Layer (Postgres + Drizzle + Cerbos; `cms.*` schema namespace для Payload tables)
