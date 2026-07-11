---
title: "DS Platform — Frontend Stack design [RU]"
description: "1. Meta-framework: Next.js 15 App Router + RSC, один framework на все 6 веб-поверхностей. 2. App-split: 4 Next.js приложения — apps/promo (SSG/ISR,..."
lang: ru
---

> **EN:** [`0004-frontend-stack-design-en.md`](./0004-frontend-stack-design-en.md) · **RU (this)**

# DS Platform — Frontend Stack design

**Дата:** 2026-05-14
**Мастер:** репозиторий → `apps/docs/content/adr/0004-frontend-stack-design-ru.md`
**Автор:** Tech Lead Сидоров
**Связан с:** Plane DSO-28 (`b9b950e8-6ad2-4e50-807d-f7e74aaeed5a`), milestone DSO-24
**Наследует:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend core: NestJS+TS, Zod, REST, Centrifugo, Timeweb storage/CDN, openapi-typescript SDK), ADR-0003 (Postgres+Drizzle+Cerbos+Redis, single instance)
**Входы:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.4/§9.x, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `knowledge-base/documents/Doctor-School-Platform-PRD-v1.md` §5/§7/§13-21, `docs/documentation-pattern/documentation-framework-final.md`
**Выход:** `apps/docs/content/adr/0004-frontend-stack-ru.md` + входы для DSO-29 (Mobile), DSO-30 (AI runtime), DSO-31 (Repo strategy)

---

## 0. TL;DR

1. **Meta-framework:** Next.js 15 App Router + RSC, один framework на все 6 веб-поверхностей.
2. **App-split:** 4 Next.js приложения — `apps/promo` (SSG/ISR, doctor.school) + `apps/portal` (SSR auth, app.doctor.school) + `apps/admin` (Refine, admin.doctor.school) + `apps/cms` (Payload v3 inside Next.js, cms.doctor.school).
3. **Deployment topology v1-v2:** один VPS "frontend-prod" + 4 Docker containers + nginx reverse-proxy. v3+ — раздельные VPS при 1M MAU.
4. **Admin/CMS framework:** Refine + custom REST data provider → NestJS API + Cerbos access provider + custom Zitadel auth strategy. Без headless CMS как замены backend.
5. **Design-system:** Tailwind CSS 4 + shadcn/ui + lucide-react + Radix Primitives. Общий `packages/design-system`. Heavy-composes (TipTap rich-text, Tanstack Table, react-day-picker, Recharts/Tremor) — поверх shadcn shell.
6. **User cabinets UI:** custom React на shadcn/ui + Tanstack Query + RHF + Zod (не Refine — brand-UX требует кастомизации).
7. **Data-fetching:** Tanstack Query v5 + RSC hybrid (initial SSR через RSC + client interactivity через TQ) + Server Actions точечно для simple admin-mutations. Tanstack Query — единый pattern на все 4 apps. **Caveat:** Refine в `apps/admin` управляет собственным `QueryClient` через `<Refine>` provider (Refine — client-side). Это значит admin app — effectively CSR с тонким SSR-shell; RSC `HydrationBoundary` pattern применим в portal/promo/cms, но не для Refine-managed resources в admin. Tanstack Query как библиотека — общая, но cache-instances изолированы per-app.
8. **Forms:** RHF + `@hookform/resolvers/zod` + shadcn `<Form>`. Zod-схема — один SSOT в `packages/api-client/schemas/` (frontend + backend NestJS обе используют тот же import).
9. **Promo content source:** Payload CMS v3 content-only в `apps/cms`, Postgres `cms.*` namespace в shared Postgres-instance из ADR-0003. Custom Lexical features для inline SSOT-glossary insertions. MCP server для AI-агентов. Custom Auth Strategy → Zitadel.
10. **Image optimization:** гибрид — build-time variants через Next.js static imports (promo) + `next/image` Sharp on Node (dynamic) + Payload Sharp pipeline (media library). Timeweb CDN — общий delivery cache layer.
11. **Real-time клиент:** `centrifuge` npm package + кастомные React hooks в `packages/api-client`. Tanstack Query `invalidateQueries` по WS-событиям из Centrifugo (ADR-0002 §7).
12. **i18n:** `next-intl` (App Router-native, RSC-compatible). Messages в `messages/ru.json` каждого app. i18n-ready с v1 для русского, multi-lang в v2+.
13. **PWA:** `serwist` (поддерживаемый next-pwa fork) — installable manifest + service-worker navigation cache. Offline-уроки — open question (DSO-29).
14. **Testing:** Vitest (unit + integration) + React Testing Library (component) + Playwright (E2E).
15. **Lint/Format:** ESLint flat config + Prettier + `prettier-plugin-tailwindcss`. Custom rule `no-class-validator` (ADR-0002 §3).
16. **Monorepo:** pnpm workspaces + Turborepo. Minimal layout фиксирован здесь, формальный — DSO-31.
17. **Observability frontend:** GlitchTip (self-hosted, Sentry API-compatible, MIT) + `@sentry/nextjs` SDK + Web Vitals tracking.
18. **Vercel-only API запрещены** — `@vercel/*`, Edge Runtime+KV, Vercel Image Optimization, Vercel Cron, Vercel Analytics. Self-host через standalone build.

---

## 1. Scope и non-goals

### В scope DSO-28

- Meta-framework выбор (Next.js / Nuxt / SvelteKit / Astro / Remix).
- App-split decision (1 / 2 / 3 / 4 apps).
- Rendering strategy per surface (SSG / SSR / RSC hybrid).
- Admin/CMS approach (headless CMS vs admin-UI framework vs custom).
- Promo content source (MDX / Decap / TinaCMS / Keystatic / Payload).
- Design-system stack (styling + UI-kit + icons).
- Data-fetching pattern.
- Forms pattern.
- Image optimization.
- Real-time, i18n, PWA, testing, linting, monorepo base.
- Frontend observability.
- Deployment topology v1.

### Не в scope DSO-28 (делегировано)

- **Mobile stack** — DSO-29. v1 mobile = web-app PWA prototype; нативный — open в DSO-29.
- **AI runtime / LLM middleware** — DSO-30.
- **Repo strategy (формальный)** — DSO-31. Базовая monorepo-конвенция зафиксирована здесь как минимум, окончательное в DSO-31.
- **Frontend-VPS provisioning, nginx vhost configs, TLS-certs** — DSO-10 (infra readiness).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation против Zitadel IdP (закрыто по ADR-0001 §8, DSP-209).
- **Конкретные UX-флоу для кабинетов** — product задачи, не tech-decision.
- **Game-map UI для DS Clinic (#19, v3)** — отдельный design spec ближе к v3.

---

## 2. Meta-framework: Next.js 15 App Router + RSC

### 2.1. Решение

Один framework на все 6 веб-поверхностей: Next.js 15+ с App Router и React Server Components.

### 2.2. Обоснование (без bias к существующим прототипам)

Объективные критерии и веса (запрет на «команда умеет» и «hiring-pool» — [[feedback_tech_stack_criteria_no_team_skill]]):

| Критерий                     | Вес    | Next.js | Nuxt   | SvelteKit | Astro  | Remix/RR7 | Split-toolchain |
| ---------------------------- | ------ | ------- | ------ | --------- | ------ | --------- | --------------- |
| LLM-датасет (AI-quality)     | High   | +3      | 0      | -2        | -1     | 0         | +1              |
| RF self-host без vendor-lock | High   | +2      | +2     | +2        | +2     | +2        | +2              |
| SSG+SSR+hydration в одном fw | High   | +3      | +3     | +3        | +2     | +1        | +2              |
| UI-kit ecosystem             | High   | +3      | +1     | 0         | +2     | +3        | +3              |
| i18n maturity                | Medium | +3      | +3     | +3        | +2     | -1        | +2              |
| Auth-cookie server-fetch     | Medium | +3      | +2     | +2        | +1     | +3        | +2              |
| Maturity (≥2 лет production) | Medium | +2      | +2     | +1        | +1     | 0         | +1              |
| Real-time agnostic           | Low    | +2      | +2     | +2        | +1     | +2        | +2              |
| **Weighted (H=3, M=2, L=1)** |        | **51**  | **34** | **23**    | **24** | **24**    | **36**          |

Гэп +15 баллов между лидером и вторым — Next.js доминирует по совокупности High-весовых критериев одновременно (LLM-датасет, UI-экосистема, rendering coverage, auth-cookie через RSC).

### 2.3. Vercel-bias mitigation

Запрещены в codebase:

- `@vercel/*` packages
- Edge Runtime с Vercel KV / Vercel-managed ISR
- Vercel Image Optimization (используется Sharp on Node + Timeweb CDN)
- Vercel Cron (используется BullMQ из ADR-0002 §6)
- Vercel Analytics (используется GlitchTip + Web Vitals из §18)

Self-host через `output: 'standalone'` в `next.config.ts` → Docker image ~100MB → Node runtime в контейнере. Никаких Vercel-only фич не используем.

### 2.4. Отвергнутые альтернативы (резюме)

- **Nuxt 3** (-17 баллов): Vue LLM-датасет ~5× меньше React → AI code-gen quality ниже. UI-kit ecosystem уже.
- **SvelteKit** (-28): LLM-датасет ~20× меньше React → AI существенно слабее. UI-kit ecosystem узкий.
- **Astro** (-27): SSG-king, но cabinets-жанр (auth-heavy data-bound interactive) — не его. Island-pattern для cabinets переусложняет.
- **Remix → React Router 7** (-27): после слияния в RR7 framework-mode в переходном состоянии, SSG слабее, i18n не из коробки.
- **Split-toolchain (Astro promo + Next.js cabinets)** (-15): +1 балл за PageSpeed промо, -2 балла за overhead двух toolchain'ов для команды 1-2. Net negative на v1. Превратится в open question OQ-F1.

---

## 3. App-split: 4 Next.js приложения

### 3.1. Решение

```
apps/
├── promo/    # SSG/ISR, doctor.school, public
├── portal/   # SSR auth, app.doctor.school, multi-role (доктор/эксперт/клиника/инвестор)
├── admin/    # SSR auth + 2FA + Refine, admin.doctor.school (модераторы платформы)
└── cms/      # Payload v3 inside Next.js, cms.doctor.school (маркетинг-team)
```

### 3.2. Cookie / SSO topology

**Каждое приложение держит свою host-only cookie:**

- `doctor.school` (promo) — `__Host-ds_promo_session` если требуется аутентифицированное состояние для CTA / lead-форм (обычно нет — promo анонимен по умолчанию).
- `app.doctor.school` (portal) — `__Host-ds_portal_session`, host-only, `HttpOnly`, `Secure`, `SameSite=Lax`.
- `admin.doctor.school` (admin) — **staged session model**. Волна 1 (в объёме live-вебинара 2026-07-17 — фича 007, минимальный event-admin): admin-приложение аутентифицируется через отгруженную 003 session cookie `__Host-ds_session` (host-only, `HttpOnly`, `Secure`, `SameSite=Lax`, без 2FA), отправляемую same-origin через admin `/v1/*` proxy — принято для одной доверенной группы `platform_admin`, чьи мутации уже идут через high-stakes introspection tier (ADR-0001 §2.5/§8). Pre-pilot hardening (обязателен до пилота 2026 Q3, трекается Issue [#718](https://github.com/doctor-school/ds-platform/issues/718)): выделенная cookie `__Host-ds_admin_session`, host-only, `SameSite=Strict`, плюс обязательная 2FA для сессий `platform_admin` — целевая session model этого ADR.
- `cms.doctor.school` (cms) — `__Host-ds_cms_session`, host-only, для маркетинг-team.
- `docs.doctor.school` (docs) — `__Host-ds_docs_session` если требуется auth (внутренняя SSOT для команды, обычно через VPN).

Полный security profile cookie (TTL, rotation, CSRF, fingerprint binding) — **ADR-0001 §6** (single source of truth). Этот документ — implementation reference только для Next.js-specific деталей (см. §3.2.1).

#### 3.2.1. Cross-app SSO via OIDC silent re-auth — frontend implementation (DSO-63 #2)

Cross-app login continuity между portal, admin, promo, docs, cms — через OIDC silent re-auth (`prompt=none`) у IdP, не через shared cookie на `.doctor.school`. Shared cookie отвергнут per ADR-0001 §6 — same-origin XSS или subdomain takeover скомпрометировали бы admin-сессию, а CSRF / fingerprint mitigations обходятся same-origin XSS. См. ADR-0001 §6 для полного обоснования.

**Frontend pattern для каждого Next.js app:**

```ts
// apps/{app}/middleware.ts
import { NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const session = req.cookies.get("__Host-ds_" + APP_NAME + "_session");
  if (session) return NextResponse.next();

  // No local session → silent re-auth attempt via IdP
  const url = new URL("https://auth.doctor.school/oauth/authorize");
  url.searchParams.set("client_id", APP_OAUTH_CLIENT_ID);
  url.searchParams.set("prompt", "none");
  url.searchParams.set("redirect_uri", `https://${APP_HOSTNAME}/auth/callback`);
  url.searchParams.set("state", generateState(req));
  return NextResponse.redirect(url);
}
```

**Auth callback handler:**

```ts
// apps/{app}/app/auth/callback/route.ts
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    // No code = IdP returned login_required → fall through to login UI
    return NextResponse.redirect(
      `https://auth.doctor.school/login?return_to=${ENCODED_RETURN}`,
    );
  }
  const tokens = await exchangeCodeForTokens(code);
  // Set host-only cookie with session reference
  const response = NextResponse.redirect(returnUrl);
  response.cookies.set("__Host-ds_" + APP_NAME + "_session", tokens.sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // 'strict' для admin/cms
    path: "/",
    maxAge: WEB_SESSION_TTL_SECONDS,
  });
  return response;
}
```

**Visible UX:** для уже залогиненного пользователя — instantaneous redirect (≤300ms), без явного login screen. Для незалогиненного — нормальный login flow на `auth.doctor.school/login`.

**Logout:**

```ts
// apps/{app}/app/auth/logout/route.ts
export async function POST() {
  // App-level logout
  const response = NextResponse.redirect("/");
  response.cookies.delete("__Host-ds_" + APP_NAME + "_session");
  return response;
}

// apps/{app}/app/auth/logout-global/route.ts — для "logout from all"
export async function POST() {
  // Local cookie delete + redirect к IdP global logout endpoint
  const response = NextResponse.redirect(
    "https://auth.doctor.school/oidc/logout",
  );
  response.cookies.delete("__Host-ds_" + APP_NAME + "_session");
  return response;
}
```

**CSRF protection:** double-submit pattern (cookie + header) на всех state-changing endpoints. Реализуется через NestJS middleware на API stороне (см. identity-auth-rbac-design §7.5).

**Mobile native (RN+Expo):** не использует cookie-flow; работает с token-based auth + Keychain/Keystore напрямую к API. Описано в `mobile-stack-design`, без изменений по DSO-63.

### 3.3. Обоснование

Матрица (-3...+3):

| Критерий                     | Вес    | A. 1 app | B. 2 apps (admin isolated) | C. 3 apps + cms (=4)  |
| ---------------------------- | ------ | -------- | -------------------------- | --------------------- |
| Security perimeter isolation | High   | -2       | +2                         | **+3**                |
| Bundle-перф per zone         | High   | -2       | 0                          | **+2**                |
| Multi-role UX                | High   | +3       | +3                         | +2                    |
| Deploy cadence               | Medium | -2       | +1                         | **+3**                |
| Operational complexity       | Medium | +3       | +1                         | -1                    |
| AI mental boundary           | Medium | -1       | +1                         | **+2**                |
| Code-sharing overhead        | Medium | +2       | 0                          | -1 (требует monorepo) |
| **Weighted**                 |        | +1       | +19                        | **+24**               |

App `cms` добавлен после фиксации Payload как promo content source (см. §10) — Payload v3 — это Next.js app, добавляется в общий topology без дополнительных runtime'ов.

### 3.4. Deployment topology v1-v2

Один VPS "frontend-prod" (Timeweb, 2-4 vCPU / 4-8 GB RAM):

```
nginx (reverse-proxy + TLS termination)
  ├─ doctor.school        → promo container
  ├─ app.doctor.school    → portal container
  ├─ admin.doctor.school  → admin container
  └─ cms.doctor.school    → cms container (Payload v3)
```

4 Next.js standalone builds, каждый ~150-300MB image, ~150-300MB RAM. Итого ~1-2GB RAM на 4 контейнера. 2-4 vCPU тянет легко на v1-v2 (≤десятки тысяч MAU).

v3+ trigger (OQ-F3): 1M MAU цель, или Centrifugo+SSR на одном VPS становится bottleneck → split на отдельные VPS.

---

## 4. Rendering strategy per surface

| Поверхность               | Жанр                                                 | Режим                                                                |
| ------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Promo (#21)               | Public SEO, PageSpeed ≥80, маркетинг-контент         | **SSG/ISR**                                                          |
| Web-кабинет врача (#17)   | Auth-only, mobile-first, вебинар-просмотр, документы | **SSR (RSC) first paint + client-hydration + SPA-like internal nav** |
| Кабинет эксперта (#18)    | Auth-only, CMS-редактор курсов                       | SSR shell + client-rich rich-text                                    |
| Кабинет инвестора (#20)   | Auth-only, маркетплейс рекламы + ROI dashboard       | SSR shell + client-rich dashboard                                    |
| Кабинет клиники (#19, v3) | Auth-only, canvas/WebGL карта + dashboard            | SSR shell + client + canvas-mount                                    |
| Admin (#14)               | Auth-only + 2FA, Refine CRUD                         | **Effective CSR с тонким SSR-shell** (см. ниже)                      |
| CMS (Payload)             | Auth-only (маркетинг), admin UI                      | Payload-native SSR + admin SPA                                       |

Pattern «SSR-default first paint + client-hydration + SPA-like internal navigation» — out-of-box Next.js App Router. Никаких чистых SPA, никаких MPA-без-routing. Промо — SSG/ISR (статика без runtime CPU).

⚠️ **Caveat для admin:** Refine = client-side framework (требует `<Refine>` provider за `"use client"` boundary). Это значит:

- SSR-shell для admin ограничен outer layout (auth-guard, theme)
- Все Refine-managed страницы внутри — CSR (нет RSC server-fetch с HttpOnly cookie для resource data)
- `HydrationBoundary` pattern Tanstack Query применим только в portal/promo/cms; в admin Refine управляет своим `QueryClient` (cache-instance изолирован per-app)

Для внутреннего admin tool (модераторы, ≤десятки пользователей) это acceptable trade-off — performance менее критичен чем для public-facing portal. AI pipeline UI v3 (когда появится) — обычные React-routes inside Refine, тот же CSR pattern.

---

## 5. Admin/CMS framework: Refine

### 5.1. Решение

В `apps/admin` используем Refine framework для CRUD-операций (модерация, верификация медстатуса, выдача ДПО, user management). Custom React-страницы поверх Refine для специфики (AI pipeline UI v3).

Stack:

- **Refine core** + `@refinedev/nextjs-router` + `@refinedev/react-hook-form` + `@refinedev/react-table`
- **Data provider:** custom REST adapter (~100 строк) → NestJS API из ADR-0002. Convention: cursor-pagination (не offset), RFC 7807 errors, Idempotency-Key headers, path-versioning `/v1/`.
- **Auth provider:** custom (~50 строк) → Zitadel JWT с two-tier validation (JWT fast-path + introspect для high-stakes, наследие ADR-0001 §6).
- **Access provider:** custom adapter (~50-100 строк) поверх `@cerbos/embedded` SDK (ADR-0003 §5 — embedded mode на v1). Refine даёт generic `accessControlProvider` interface; Cerbos — **документированный community pattern** в Refine docs, не packaged `@refinedev/cerbos`. Реализация локальная.
- **UI:** Refine UI-agnostic, используем shadcn/ui (`Your UI` опция в Refine — компоненты в `packages/design-system`).

### 5.2. Обоснование

| Критерий                               | Вес    | Refine                 | React Admin      | AdminJS             | Custom shadcn |
| -------------------------------------- | ------ | ---------------------- | ---------------- | ------------------- | ------------- |
| License OSS без cap                    | High   | +3                     | +3               | +3                  | +3            |
| Drizzle/ADR-0003 совместимость         | High   | +3 (BYOA)              | +3               | -1 (custom adapter) | +3            |
| NestJS/ADR-0002 совместимость          | High   | +3 (BYOA)              | +3               | -1                  | +3            |
| Zitadel/ADR-0001 интеграция            | High   | +3 (auth provider)     | +3               | +2                  | +3            |
| Admin UI auto-gen                      | High   | +2                     | +2               | +3                  | -3            |
| Custom AI pipeline UI v3 extensibility | Medium | +3 (just React routes) | +3               | 0                   | +3            |
| shadcn/ui native fit                   | High   | +3 (UI-agnostic)       | -1 (MUI default) | -1                  | +3            |
| LLM-датасет                            | Medium | +2                     | +2               | +1                  | +3            |
| **Weighted**                           |        | **68**                 | 61               | 33                  | 60            |

Refine выигрывает потому что UI-agnostic (нативно работает с shadcn/ui — наш design-system) + generic `accessControlProvider` interface совместим с custom Cerbos adapter (~50-100 строк, документированный community pattern). Это всё ещё значительно меньше работы, чем reinventing CRUD-UI с нуля (Custom shadcn baseline).

### 5.3. Что НЕ Refine

User cabinets (`apps/portal` — доктор/эксперт/клиника/инвестор) не используют Refine. Brand-UX требует кастомных flow (CMS-редактор курсов для эксперта, игровая карта клиники, маркетплейс инвестора), не generic CRUD. В portal — чистый React на shadcn/ui + Tanstack Query + RHF + Zod.

Разделение хорошее: AI-агент в `apps/admin` видит Refine-конвенции (`<List resource="users">`); в `apps/portal` — обычный React. Два чётких mental model, не один смешанный.

### 5.4. Отвергнутые альтернативы

- **Headless CMS как admin** (Payload-as-full-admin / Strapi / Directus / Keystone): дублируют backend (свой API + свой ORM + своя auth) рядом с уже выбранным ADR-0002 NestJS. Не «обвязка над backend», а параллельный backend. Не подходит.
- **React Admin**: -7 баллов. Native fit с MUI, конфликт с shadcn/ui design-system.
- **AdminJS**: -35 баллов. Tight ORM-coupling, нет Drizzle adapter.
- **Low-code (Retool / Appsmith / ToolJet / Budibase)**: drag-and-drop incompatible с AI-first dev (LLM не пишет drag-drop конфиги).
- **Custom shadcn без framework**: -8 баллов. Каждый CRUD-flow пишется руками — много upfront work для модерации, audit-log UI, role-management.

---

## 6. Design-system: Tailwind + shadcn/ui + lucide-react

### 6.1. Решение

Общий `packages/design-system` workspace-пакет, consumed всеми 4 apps:

- **Styling engine:** Tailwind CSS 4 (новый Oxide engine, ~10× быстрее v3 build, CSS output ~5KB после purge)
- **UI-kit:** shadcn/ui — owned-code компоненты (Tailwind + Radix UI primitives), копируются в репо через `npx shadcn add <component>`, не npm-dependency
- **Icons:** lucide-react (~1.5k icons, MIT, tree-shakable, shadcn default)
- **Дополнительно поверх shadcn shells:**
- Rich-text editor (кабинет эксперта #18 + Payload Lexical) → TipTap + custom extensions
- Data table (admin) → Tanstack Table + shadcn `<Table>` shell
- Charts (инвестор #20, analytics) → Recharts или Tremor (shadcn-flavored)
- Date picker → react-day-picker + shadcn `<Calendar>` primitive
- Calendar (#17 v3) → react-big-calendar или FullCalendar в shadcn-обёртке

### 6.2. Обоснование

| Критерий              | Вес    | Tailwind+shadcn     | Tailwind+Mantine | CSS Modules+Radix | Panda+Park | Emotion+MUI | Tailwind+Ant |
| --------------------- | ------ | ------------------- | ---------------- | ----------------- | ---------- | ----------- | ------------ |
| LLM-датасет           | High   | **+3**              | +2               | -1                | -2         | +3          | +2           |
| RSC-совместимость     | High   | **+3**              | +2               | +3                | +3         | **-3**      | -2           |
| Customization scope   | High   | **+3** (owned-code) | +1               | +3                | +2         | -1          | -2           |
| Bundle / runtime cost | High   | **+3**              | 0                | +3                | +3         | -1          | -2           |
| Component coverage    | Medium | +1                  | +3               | -3                | 0          | +3          | +3           |
| Tree-shaking          | Medium | +3                  | +2               | +3                | +3         | +1          | +1           |
| Maturity              | Medium | +2                  | +3               | +3                | 0          | +3          | +3           |
| License               | Medium | +3                  | +3               | +3                | +3         | +2          | +3           |
| **Weighted**          |        | **+44**             | +34              | +24               | +27        | +9          | +15          |

Tailwind + shadcn/ui — RSC-native (static CSS, никаких runtime CSS-in-JS workaround'ов), maximum LLM-датасет, owned-code customization без бой с UI-kit-нацией.

### 6.3. AI-friendly customization для DS-brand

> **Пересмотрено ADR-0013** (design-token SoT и theming + методология block-adoption). Исходное обещание — «DS-токены в `packages/design-system/tokens.json` → Tailwind theme config» — так и не материализовалось; механизм ниже его замещает.

Под medical-brand и будущую геймификацию:

- **Токены — единый источник истины** в формате DTCG (`packages/design-system/tokens/*.json`, три слоя primitive → semantic → component), компилируются **Style Dictionary** в Tailwind v4 `@theme` + `:root`/`.dark` CSS-переменные — **не** рукописный `tokens.json` и не `tailwind.config` theme-объект. Компоненты ссылаются только на semantic/component-токены; одно изменение semantic-слоя перекрашивает всё приложение. (ADR-0013 §1–2; tech-spec design-system-foundation §2.)
- **Adoption блоков до bespoke:** UI собирается из готовых блоков/компонентов с фиксированного whitelist реестров (gate `build-ui-from-design-system`), переодетых в токены и owned в `src/blocks`/`src/primitives`. (ADR-0013 §4.)
- Mascot integration, Lottie/Rive для game-card animations (см. PRD §15 — геймификация); namespace `game.*` зарезервирован.
- Con/Pul/Au cards — кастомные shadcn-extended компоненты поверх token-оболочки.

---

## 7. User cabinets UI: Custom React + shadcn/ui

### 7.1. Решение

`apps/portal` (доктор / эксперт / клиника / инвестор) реализуется custom React-кодом на:

- shadcn/ui компонентах (из `packages/design-system`)
- Tanstack Query для server-state (см. §8)
- React Hook Form + Zod resolver для forms (см. §9)
- Tanstack Table для data-grids
- React Context для cross-component theme/auth/locale state
- Zustand для cross-component non-server state (если возникнет — например draft-курса эксперта до submit)

### 7.2. Что НЕ используем

- Redux Toolkit — overkill, Tanstack Query покрывает server-state, useState/Context — client-state
- MobX / Recoil / Jotai — niche, меньшие LLM-датасеты

---

## 8. Data-fetching: Tanstack Query v5 + RSC hybrid

### 8.1. Решение

```
┌─────────────────────────────────────────────────────────────┐
│  RSC server component (Next.js App Router)                  │
│   - Initial data fetch к NestJS API через HttpOnly cookie    │
│   - Streaming SSR, server-only auth-flow                     │
│   - HydrationBoundary serializes query state to client       │
└────────────────────┬────────────────────────────────────────┘
                     │ dehydrate → hydrate
┌────────────────────▼────────────────────────────────────────┐
│  Client Component (Tanstack Query v5)                        │
│   - useQuery / useMutation / useInfiniteQuery                │
│   - Optimistic updates                                        │
│   - Cache invalidation от Centrifugo WS-событий              │
└─────────────────────────────────────────────────────────────┘
                     ↑
                     │ queryClient.invalidateQueries
┌────────────────────┴────────────────────────────────────────┐
│  Centrifugo WS handler → invalidate cache → re-fetch         │
└─────────────────────────────────────────────────────────────┘
```

Server Actions используются точечно для simple admin-mutations без client-cache (например, «отклонить курс» — Server Action + `revalidatePath`).

### 8.2. Обоснование

| Критерий               | Вес    | Tanstack Query                     | SWR       | RSC-only |
| ---------------------- | ------ | ---------------------------------- | --------- | -------- |
| LLM-датасет            | High   | +3                                 | +1        | 0        |
| Feature richness       | High   | +3                                 | +1        | -2       |
| RSC integration        | High   | +3 (HydrationBoundary)             | +2        | +3       |
| Consistency с Refine   | High   | +3 (Refine BUILDS on TQ)           | -3        | -3       |
| Real-time invalidation | High   | +3 (queryClient.invalidateQueries) | +2        | -3       |
| Bundle                 | Medium | +1 (~12KB)                         | +3 (~5KB) | +3       |
| TS quality             | Medium | +3                                 | +2        | +3       |
| Maturity               | Medium | +3                                 | +3        | +1       |
| **Weighted**           |        | **+59**                            | +25       | -1       |

Решающий фактор: Refine построен поверх Tanstack Query → если использовать SWR в portal, получится два разных server-state engines в codebase. Также real-time invalidation через `queryClient.invalidateQueries` — one-liner с TQ, workaround с RSC-only (`revalidatePath` re-renders всю страницу).

---

## 9. Forms: RHF + Zod resolver + shadcn `<Form>`

### 9.1. Решение

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@ds/design-system/form";
import { courseCreateSchema, type CourseCreateInput } from "@ds/api-client";

function CreateCourseForm() {
  const form = useForm<CourseCreateInput>({
    resolver: zodResolver(courseCreateSchema),
    defaultValues: { title: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: api.courses.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(mutation.mutate)}>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название курса</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
```

Zod-схема — один SSOT в `packages/api-client/schemas/course.ts`:

- Backend NestJS импортирует и валидирует request body
- Frontend импортирует и использует через `zodResolver`
- TypeScript-тип выводится один раз через `z.infer`

### 9.2. Обоснование

shadcn/ui `<Form>` примитив построен **на RHF**. Refine официально использует RHF в form helpers. Это не competing choice — это встроенный pattern уже принятых решений.

| Критерий              | Вес    | RHF + Zod         | Conform | Native FormData | Formik |
| --------------------- | ------ | ----------------- | ------- | --------------- | ------ |
| LLM-датасет           | High   | +3                | 0       | +1              | +1     |
| Zod integration       | High   | +3                | +3      | -1              | +2     |
| Refine integration    | High   | +3                | -2      | -3              | -2     |
| shadcn `<Form>`       | High   | +3 (built on RHF) | -3      | -3              | -3     |
| Feature richness      | High   | +3                | +1      | -2              | +3     |
| Server Actions compat | Medium | +2                | +3      | +3              | +1     |
| TS quality            | Medium | +3                | +3      | +1              | +2     |
| Maturity              | Medium | +3                | +1      | +3              | +3     |
| **Weighted**          |        | **+61**           | +11     | -10             | +15    |

---

## 10. Promo content source: Payload CMS v3 content-only

### 10.1. Решение

Payload CMS v3 живёт inside Next.js в `apps/cms`. Owns ТОЛЬКО marketing-content tables (`pages`, `blocks`, `glossary`, `media`) в Postgres `cms.*` schema namespace. **Не trogue domain data DS Platform** (это NestJS+Drizzle через `public.*`).

### 10.2. Архитектура

```
apps/cms/ (Next.js app + Payload v3 plugin)
  ├── payload.config.ts          # Schema-as-code TS — SSOT для collections
  ├── collections/
  │   ├── pages.ts                # Marketing pages
  │   ├── blocks.ts               # Reusable page-blocks
  │   ├── glossary.ts             # Domain term registry (label + aliases + def)
  │   └── media.ts                # Image/video uploads → Timeweb S3
  └── lexical-features/
      └── glossary-term-feature.ts  # Custom Lexical editor toolbar "Insert glossary term"

Postgres (общий с domain):
  - public.*   ← Drizzle, domain tables (users, courses, etc.)
  - cms.*      ← Payload, content tables (cms_pages, cms_glossary, etc.)
```

### 10.2.1. Postgres privilege separation (security boundary)

⚠️ **Намеренное усиление:** namespace separation `cms.*` vs `public.*` — недостаточно как security boundary. Это **naming convention** на уровне query patterns, не privilege enforcement. Без role-level разделения Payload migration runner (или misconfigured тест) может случайно операционировать вне `cms.*`.

Решение — **dedicated Postgres roles** (фиксируется как требование к DSO-10; ADR-0003 §1 обновляется inline, чтобы зафиксировать multi-role privilege separation наряду с single-instance топологией):

```sql
-- DDL для Postgres (выполняется при provisioning, DSO-10 / DSO-27 follow-up)
CREATE ROLE app_owner LOGIN PASSWORD '...';
CREATE ROLE cms_owner LOGIN PASSWORD '...';

CREATE SCHEMA public AUTHORIZATION app_owner;
CREATE SCHEMA cms    AUTHORIZATION cms_owner;

-- app_owner: USAGE only на public
GRANT USAGE  ON SCHEMA public TO app_owner;
GRANT CREATE ON SCHEMA public TO app_owner;
REVOKE ALL   ON SCHEMA cms    FROM app_owner;

-- cms_owner: USAGE only на cms
GRANT USAGE  ON SCHEMA cms TO cms_owner;
GRANT CREATE ON SCHEMA cms TO cms_owner;
REVOKE ALL   ON SCHEMA public FROM cms_owner;
```

**Connection strings:**

- NestJS (`apps/api`, Drizzle) → `postgresql://app_owner:.../ds_platform`
- Payload (`apps/cms`) → `postgresql://cms_owner:.../ds_platform`

Это гарантирует:

- Payload migration runner физически **не может** DROP/ALTER таблицу в `public.*` (Drizzle domain) даже при ошибочной конфигурации
- Drizzle migration runner физически **не может** trogue Payload `cms.*` tables
- Audit log на Postgres уровне (`pg_audit`) показывает чёткое разделение agent ↔ schema

**Read-cross-schema (если потребуется):** портал может SELECT из `cms.pages` для рендеринга промо-контента → добавляется `GRANT SELECT ON ALL TABLES IN SCHEMA cms TO app_owner;` точечно. Write — никогда cross-schema.

Это требование расширяет ADR-0003 §1: single Postgres instance теперь обязывает **multi-role privilege separation** с появлением `cms.*` namespace. ADR-0003 §1 обновляется inline, чтобы это отразить.

### 10.3. SSOT enforcement via Glossary

Маркетолог в Payload admin UI:

1. Редактирует промо-страницу в Lexical rich-text editor.
2. Хочет упомянуть бренд → нажимает кнопку «📚 Insert glossary term» в toolbar.
3. Видит dropdown терминов из Glossary collection (brand_name, product_orthobio_school, currency_au, ...).
4. Выбирает `brand_name` → в JSON-структуре контента вставляется reference `{ type: 'glossary-ref', termId: 'brand_name' }`.
5. При рендеринге в Next.js promo replaces на `glossary.brand_name.label` ("Doctor.School").

Когда glossary обновляется ("Doctor.School" → "DS.RU") → все промо-страницы автоматически подхватывают на следующем ISR-revalidate. Никаких search-and-replace.

**CI-lint (drift detection):** проверяет рендеренный HTML промо-страниц на свободные литералы canonical-терминов. Блокирует publish если найдено («Doctor.Scool» с опечаткой → блок).

### 10.4. Auth integration

Payload v3 имеет свою auth-систему — мы overrideем custom Auth Strategy:

- Маркетолог логинится через Zitadel (как везде в DS Platform).
- JWT-token проверяется в Payload через custom strategy (~50 строк TS).
- Payload-сессия mapped на пользователя из Zitadel (Payload local user mirror через webhook outbox из ADR-0002 §5).
- Permissions внутри Payload (кто что может редактировать) → mapping на роли из JWT.

### 10.5. AI-agent integration

Payload v3 имеет **MCP server** — AI-агент (Claude Code, Cursor) может через MCP:

- Читать содержимое страниц
- Видеть Glossary terms
- Видеть schema collections (которая schema-as-code в TS — также в git)

Это даёт AI полный visibility marketing-content без write-доступа.

### 10.6. Обоснование выбора (без doc-bias)

| Критерий                                  | Вес    | MDX inline | Decap CMS | TinaCMS | Keystatic | **Payload content-only** |
| ----------------------------------------- | ------ | ---------- | --------- | ------- | --------- | ------------------------ |
| SSOT enforcement (placeholders/relations) | High   | +1         | +1        | +3      | +2        | **+3**                   |
| AI-friendliness                           | High   | +3         | +3        | +2      | +3        | +2 (MCP)                 |
| UI quality для маркетолога                | High   | -3         | -2        | +3      | +2        | **+3**                   |
| Modern, AI-native                         | High   | +1         | -2        | +2      | +3        | **+3**                   |
| Маркетолог без git                        | High   | -3         | +3        | +3      | +3        | **+3**                   |
| Schema-as-code в git                      | Medium | +3         | 0         | +2      | +3        | **+3**                   |
| Self-host RF                              | High   | +3         | +3        | +2      | +3        | +3                       |
| License MIT без cap                       | Medium | +3         | +3        | +2      | +3        | +3                       |
| Operational complexity                    | Medium | +3         | +2        | 0       | +2        | **-1**                   |
| **Weighted (H=3, M=2)**                   |        | **21**     | 25        | 51      | 61        | **64**                   |

Payload выигрывает потому что закрывает 5 строгих требований одновременно:

- SSOT enforcement через relations + custom Lexical features + CI-lint
- Auto-git замена — admin UI вместо PR-flow
- Modern AI-native paradigm
- Polished UI (Payload v3 admin)
- Маркетолог без git-знакомства

Trade-off — operational complexity (-1): Payload это новый Next.js app (`apps/cms`) + Payload migrations рядом с Drizzle (в разных schema namespace) + custom Zitadel Auth Strategy ~50 строк. Это плата за остальные 5 побед.

### 10.7. Trigger пересмотра

OQ-F4: если маркетинг scope сузится до 3-5 статических лендингов И не возникнет потребности в inline-glossary references в rich-text → можно переехать на Keystatic (git-based, без сервера). Trigger: маркетинг-команда осознанно отказывается от polished admin UI ради zero ops overhead.

---

## 11. Image optimization

### 11.1. Решение — гибрид

| Use-case                                                     | Решение                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Promo SSG (marketing illustrations, mascot, hero-images)     | Next.js static imports → **build-time variants** → `_next/static/` → Timeweb CDN кэш как статика |
| Portal user-uploaded (аватары, course covers, lesson images) | `next/image` + Sharp on Node + Timeweb CDN кэш по transformed URL                                |
| Admin user-uploaded (диплом-сертификаты)                     | То же, низкая частота                                                                            |
| Payload media library                                        | Payload's встроенный Sharp pipeline → variants в Timeweb Object Storage → CDN serve              |

Все assets — общий delivery layer Timeweb CDN.

### 11.2. Обоснование

| Критерий               | Вес    | Sharp Node | Pre-build | imgproxy | **Гибрид** |
| ---------------------- | ------ | ---------- | --------- | -------- | ---------- |
| CPU load на Node       | High   | -1         | +3        | +3       | +1         |
| Cache hit rate / LCP   | High   | +2         | +3        | +3       | +3         |
| Operational complexity | High   | +3         | +2        | -1       | +2         |
| User-uploaded support  | High   | +3         | -3        | +3       | +3         |
| AI-friendliness        | Medium | +3         | +2        | +1       | +3         |
| Cost                   | Medium | +3         | +3        | -1       | +3         |
| **Weighted**           |        | +43        | +27       | +39      | **+50**    |

(Вариант «Timeweb CDN native transforms» снят — feature не существует на Timeweb CDN, подтверждено 2026-05-14.)

Гибрид выигрывает потому что каждый use-case получает оптимальное решение.

### 11.3. Migration triggers

- **OQ-F6 закрыт (2026-05-14):** Timeweb CDN не имеет native image transforms (подтверждено support'ом Timeweb). Sharp on Node остаётся primary path для dynamic transforms на v1.
- **OQ-F10: imgproxy sidecar** — trigger: Node CPU >70% на image-transforms в peak, или Sharp p99 latency >500ms. Это становится более вероятным trigger'ом теперь когда OQ-F6 закрыт без upgrade.

---

## 12. Real-time: centrifuge-js + Tanstack Query invalidation

### 12.1. Решение

```ts
// packages/api-client/hooks/useCentrifugoChannel.ts
import { Centrifuge } from "centrifuge";
import { useQueryClient } from "@tanstack/react-query";

export function useCentrifugoChannel(
  channel: string,
  onPub?: (data: any) => void,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const sub = centrifuge.newSubscription(channel);
    sub.on("publication", (ctx) => {
      // По умолчанию invalidate соответствующий cache
      const queryKey = channelToQueryKey(channel); // e.g. ['leaderboard'] for 'leaderboard:global'
      queryClient.invalidateQueries({ queryKey });
      onPub?.(ctx.data);
    });
    sub.subscribe();
    return () => sub.unsubscribe();
  }, [channel]);
}
```

Каналы из ADR-0002 §7: `user:<uuid>`, `webinar:<id>`, `leaderboard:global`, `admin:moderation-queue`.

### 12.2. Real-time scope

| Канал                                     | App               | Версия |
| ----------------------------------------- | ----------------- | ------ |
| `webinar:<id>` (chat + presence)          | portal (#17)      | v1     |
| `leaderboard:global` (живые перестановки) | portal (#17, #23) | v2     |
| `investor:<id>` (real-time метрики)       | portal (#20)      | v2-v3  |
| `admin:moderation-queue` (новые заявки)   | admin (#14)       | v1     |

---

## 13. i18n: next-intl

### 13.1. Решение

`next-intl` в каждом app:

- Messages: `messages/ru.json` per app (изолированные namespaces — promo, portal, admin, cms)
- Общие сообщения (термины из glossary, формы) — `packages/i18n-shared/`
- Locale-routing build-in (`[locale]/...`); single-locale `ru` пока, готово к `en` в v2+
- Server Components compatible (RSC-native)
- TS-typed message keys

### 13.2. Glossary integration

Glossary terms из Payload (см. §10) могут rendering'ом injectиться в i18n messages через build-time fetch или ISR. Это синхронизирует SSOT-glossary с client-side messages.

---

## 14. Testing

### 14.1. Stack

| Layer              | Tool                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| Unit + integration | **Vitest** (Vite-native, Jest-compatible API, parallel by default)                |
| Component          | **React Testing Library** + Vitest                                                |
| E2E                | **Playwright** (cross-browser, RSC-aware, network-mocking, screenshot regression) |
| Visual regression  | Defer v2+ (OQ-F9 — Chromatic / Percy)                                             |

### 14.2. Coverage targets

- Critical paths (auth, payments, audit) — обязательно покрыты E2E
- Component unit-coverage minimum — defer v2 (OQ из ADR-0002 OQ7)
- Property-based для invariants — где применимо

---

## 15. PWA: serwist

### 15.1. Решение

`serwist` (поддерживаемый next-pwa fork с активной maintenance, MIT) в `apps/portal`:

- `manifest.json` — installable («Установить как приложение» на iOS Safari, Android Chrome, desktop)
- Service worker — navigation cache для офлайн-fallback UI shell
- Push notifications через Web Push API (для уведомлений из ADR-0002 §6)
- Icons 192/512 + apple-touch-icon (mascot + brand)

### 15.2. Offline-scope в v1

- Cached: shell, design-system assets, fonts, logos
- NOT cached: уроки, видео, course data (требуют freshness)
- Offline-чтение уроков — **OQ-F7**, defer v2+ (зависит от DSO-29 mobile sync strategy и PRD §15 OQ4)

---

## 16. Lint/Format

### 16.1. ESLint flat config

```
packages/eslint-config/
├── base.js          # @typescript-eslint, eslint-plugin-import
├── next.js          # eslint-config-next + base
├── refine.js        # next + refine-specific
└── payload.js       # next + payload-specific
```

Custom rules:

- `no-class-validator` — запрещает `class-validator` decorators и `@ApiProperty` (форсирует Zod-only из ADR-0002 §3)
- `no-vercel-only-api` — запрещает `@vercel/*` imports
- `glossary-required` — для marketing content (см. §10.3 CI-lint)

### 16.2. Prettier + plugin-tailwindcss

- `prettier-plugin-tailwindcss` — auto-sort utility classes по canonical order
- Двойная роль с ESLint: ESLint = correctness, Prettier = formatting

### 16.3. Migration trigger

OQ-F8: Biome переход — trigger ESLint CI >5 минут/PR или Prettier-плагин ecosystem отстаёт от Biome.

---

## 17. Monorepo: pnpm + Turborepo

### 17.1. Layout

```
ds-platform/
├── apps/
│   ├── promo/
│   ├── portal/
│   ├── admin/
│   ├── cms/
│   └── api/                    # NestJS из ADR-0002
├── packages/
│   ├── design-system/          # Tailwind config, shadcn компоненты, tokens
│   ├── api-client/             # openapi-typescript codegen + Zod schemas
│   ├── auth-shared/            # Zitadel JWT integration, JWKS, two-tier validation
│   ├── i18n-shared/            # Общие сообщения, glossary integration
│   ├── eslint-config/          # Shared ESLint presets
│   └── tsconfig/               # Shared tsconfig.base.json
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 17.2. Обоснование

- **pnpm vs npm/yarn:** content-addressable cache, экономит ~10× disk space, faster install, mainstream 2024-2025
- **Turborepo vs Nx:** Turborepo легче (Vercel-backed но MIT, self-host без vendor-lock), достаточно для нашего scope. Nx — для enterprise (overhead).

### 17.3. Делегировано в DSO-31

Финальное содержимое каждого package, build-pipeline, CI/CD config, versioning convention — DSO-31.

---

## 18. Observability frontend

### 18.1. Stack

- **GlitchTip** (self-hosted, Sentry API-compatible, MIT) — error tracking
- `@sentry/nextjs` SDK в каждом frontend app (думает что говорит с Sentry, по факту → GlitchTip endpoint)
- **Web Vitals** tracking (LCP, FID, CLS, INP) → GlitchTip performance dashboard
- Source maps загружаются на deploy через GlitchTip CLI

### 18.2. Hosting

GlitchTip в инфре (DSO-10), отдельный VPS или контейнер на observability-prod (TBD в DSO-10).

### 18.3. Что НЕ используем

- Sentry SaaS — US-hosted, RF-резидентность нарушает policy
- Vercel Analytics — Vercel-only API запрещён
- Google Analytics — третья сторона, 152-ФЗ риск; используем self-hosted (Plausible Analytics — open question OQ-F11 в v2+)

---

## 19. Vercel-only API enforcement

Custom ESLint rule `no-vercel-only-api` блокирует следующие imports:

- `@vercel/*` (любые packages из @vercel namespace)
- `next/og` — opciono, Sharp-based, self-host работает (исключение)

Документация:

- Запрещены features: Edge Runtime с Vercel KV/Vercel Postgres, Vercel Image Optimization, Vercel Cron, Vercel Analytics
- Используются альтернативы из ADR-0002 (BullMQ для cron, Centrifugo для realtime, Timeweb Object Storage)

---

## 20. Inheritance из других ADR (cross-reference)

### 20.1. ADR-0001 (Identity/Auth/RBAC)

- JWT auth-flow через Zitadel (закрыто по ADR-0001 §8, DSP-209).
- **Host-only `__Host-` cookie per app** (portal, admin, promo, docs, cms) — каждое приложение имеет свой scope. Полный security profile — ADR-0001 §6.
- **Cross-app SSO continuity** — через OIDC silent re-auth (`prompt=none`), не через shared cookie. Implementation details — §3.2.1.
- Two-tier validation: JWT fast-path для ≥99% запросов, IdP `/introspect` для high-stakes (payments, AU withdrawal, role-change, admin mutations, PD export).
- Hybrid RBAC: IdP coarse roles в JWT, backend fine-grained через Cerbos.

### 20.2. ADR-0002 (Backend core)

- `openapi-typescript` codegen из NestJS Zod-schemas → `@ds/api-client` npm package
- Refine data provider consume этот SDK
- Zod-schemas SSOT в `packages/api-client/schemas/` — backend NestJS и frontend RHF используют один import
- Centrifugo через `centrifuge-js` (см. §12)
- BullMQ orthogonal к frontend (async backbone бэка)
- Idempotency-Key headers обязательны для mutating запросов из frontend
- RFC 7807 Problem Details для ошибок — Refine data provider маппит на error formats

### 20.3. ADR-0003 (Data layer)

- Postgres single instance с `public.*` (domain) + `cms.*` (Payload) schemas
- Cerbos embedded через `@cerbos/embedded` SDK — Refine access provider использует те же policies что NestJS guards
- pgvector для AI recommendations (v3) — orthogonal к frontend choice

---

## 21. Open Questions (фиксируются в ADR с triggers)

| OQ        | Описание                                                                                                                                   | Trigger пересмотра                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-F1     | Миграция `apps/promo` на Astro                                                                                                             | Маркетинг ≥3 разработчиков, PageSpeed промо <90 на mobile, demand на visual-CMS workflow                                                                                                                                                                                                                                                                                                                                                                      |
| OQ-F2     | Portal split на multiple apps (доктор/эксперт/клиника/инвестор)                                                                            | Portal-bundle >500KB gzipped, или expert-CMS получает отдельный security threat model                                                                                                                                                                                                                                                                                                                                                                         |
| OQ-F3     | Scaling топологии v3                                                                                                                       | 1M MAU достигнут, или Centrifugo+SSR на одном VPS становится bottleneck                                                                                                                                                                                                                                                                                                                                                                                       |
| OQ-F4     | Migration Payload → Keystatic                                                                                                              | Маркетинг scope сужается до 3-5 статических лендингов И inline-glossary не нужен                                                                                                                                                                                                                                                                                                                                                                              |
| OQ-F5     | Auth perimeter cms vs admin                                                                                                                | Решено split: маркетинг ≠ модераторы. Пересмотр если threat models сольются                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~OQ-F6~~ | ~~Timeweb CDN native image transforms~~ — **закрыт 2026-05-14:** feature не существует на Timeweb CDN. Sharp on Node остаётся primary path | —                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OQ-F7     | Offline-уроки в PWA web                                                                                                                    | DSO-29 mobile sync-strategy фиксирует pattern; web подхватывает                                                                                                                                                                                                                                                                                                                                                                                               |
| OQ-F8     | Migration на Biome                                                                                                                         | ESLint CI-bottleneck >5 минут/PR, Prettier-плагин ecosystem отстаёт                                                                                                                                                                                                                                                                                                                                                                                           |
| OQ-F9     | Storybook для design-system                                                                                                                | Команда вырастает до ≥2 frontend, design-system >20 компонентов                                                                                                                                                                                                                                                                                                                                                                                               |
| OQ-F10    | imgproxy для image-CPU                                                                                                                     | Node CPU >70% на image-transforms в peak, Sharp p99 >500ms                                                                                                                                                                                                                                                                                                                                                                                                    |
| OQ-F11    | Self-hosted Plausible Analytics                                                                                                            | v2+ когда нужна marketing analytics с RF-residency                                                                                                                                                                                                                                                                                                                                                                                                            |
| OQ-F12    | **Payload native auth fallback**                                                                                                           | Триггер: если Zitadel-backed custom auth strategy для Payload v3 окажется неработоспособной на Phase 0 implementation (ADR-0001 §8 закрыл Zitadel; DSP-209). Consequence: Payload использует native auth (отдельный user store для маркетинг-team), SSO между cms и portal/admin **ломается** — маркетолог имеет отдельный логин/пароль. Mitigation: email-mirror на Zitadel users через webhook outbox (ADR-0002 §5), 2FA enforce'ится в Payload native auth |

---

## 22. Делегировано

- **Mobile stack** (DSO-29): v1 — web-app PWA (текущий прототип pattern), нативный (Swift+Kotlin / React Native / Flutter / KMP) — отдельная brainstorm сессия.
- **AI runtime, LLM middleware, AI-провайдеры** (DSO-30): backend-side AI pipeline, frontend только consume через NestJS API.
- **Repo strategy formal** (DSO-31): финальный monorepo layout, versioning, CI/CD, build-pipeline. Базовая конвенция здесь — minimum.
- **Frontend-VPS provisioning + nginx vhost configs + TLS-certs** (DSO-10).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation против Zitadel IdP (закрыто по ADR-0001 §8, DSP-209).
- **Game-map UI для DS Clinic #19** — design spec ближе к v3.
- **Конкретные UX-flows для каждого кабинета** — product-задачи.

---

## 23. Архитектурные качества (метрики, не декларации)

| Качество                          | Метрика                               | v1                                                       | v3                         |
| --------------------------------- | ------------------------------------- | -------------------------------------------------------- | -------------------------- |
| Bundle size (portal)              | gzipped JS на главной (initial route) | ≤200KB\*                                                 | ≤300KB                     |
| LCP (promo)                       | Mobile, throttled 3G                  | ≤2.5s                                                    | ≤2.0s                      |
| PageSpeed (promo)                 | Mobile score                          | ≥80                                                      | ≥90                        |
| TTI (portal главная)              | Mobile                                | ≤3.5s                                                    | ≤2.5s                      |
| AI code-gen accuracy (subjective) | % first-shot working                  | ≥80% (выбор Tailwind+shadcn+RHF+Zod+TQ — все mainstream) | ≥90%                       |
| Deploy frequency                  | Independent apps                      | 4 independent pipelines                                  | Same                       |
| Cold start (Node)                 | Per-container                         | ≤2s                                                      | ≤1s                        |
| Image-transform CPU load          | Node CPU при peak                     | ≤50%                                                     | ≤30% (триггер на imgproxy) |
| Web Vitals INP                    | p75                                   | ≤200ms                                                   | ≤100ms                     |

\* **Bundle ≤200KB достигается только при дисциплине code-splitting:** route-based dynamic imports (`next/dynamic`) обязательны для heavy-компонентов — TipTap rich-text (~80KB), Recharts/Tremor (~60-100KB), react-big-calendar / FullCalendar (~50-80KB), Lottie player для game-cards. Главный chunk содержит только React+Next runtime (~100KB) + shadcn primitives initial set (~30KB) + Tanstack Query (~12KB) + RHF+Zod (~25KB) + Centrifuge (~13KB) + next-intl (~3KB). Bundle-analyzer обязателен в CI (`@next/bundle-analyzer`) — порог `≤200KB gzipped initial route` enforce'ится автоматически. Установка CI bundle-budget — DSO-31.

---

## 24. Risks

| Risk                                                                     | Severity                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel-bias соблазнит использовать `@vercel/*` API                       | Medium                     | Custom ESLint rule `no-vercel-only-api` + явный список в §19 + review в PR                                                                                                                                                                                                                                                                                                                                  |
| Payload + Drizzle двойной migration tool путает или trogues чужой schema | High                       | **Postgres role-level privilege separation** (см. §10.2.1): `cms_owner` имеет USAGE only на `cms.*`, `app_owner` only на `public.*`. Namespace-naming convention усилена privilege enforcement. README в `apps/cms` объясняет boundary                                                                                                                                                                      |
| **Composite SLO mismatch (single-VPS frontend × single-VPS backend)**    | **High**                   | Backend SLO v1 = 99.0% (ADR-0002), frontend SLO v1 = 99.0% (этот ADR). Composite end-to-end availability v1 ≈ **98.0%** (две независимые single-node системы в серии). Это материально хуже декларируемых индивидуальных SLO. Mitigation: Docker `restart: always` policy + watchdog alert на каждом VPS + manual failover SOP документирован в DSO-10. v3 trigger — split на отдельные VPS с auto-failover |
| **Webinar 10k concurrent при failure frontend-prod VPS**                 | **Medium-High**            | При падении frontend-prod VPS во время live-вебинара все 10k zрителей теряют web-experience независимо от health Centrifugo (ADR-0002 §7). Mitigation v1: pre-warmed cold-standby snapshot VPS (manual failover ≤15 мин), monitoring alert per-app. v2 trigger — active-passive HA                                                                                                                          |
| Payload auth integration с Zitadel сложнее планов                        | Medium                     | Phase 0 implementation (~2 дня) валидирует feasibility; fallback — Payload native auth + email-mirror на portal users                                                                                                                                                                                                                                                                                       |
| Refine не покрывает custom admin-flows (AI pipeline UI v3)               | Medium                     | Custom React routes поверх Refine — стандартный pattern; обозначен в §5.3                                                                                                                                                                                                                                                                                                                                   |
| RSC + Tanstack Query гидрация bug-prone                                  | Low                        | Канонический pattern (`HydrationBoundary`) задокументирован; покрывается E2E Playwright                                                                                                                                                                                                                                                                                                                     |
| AI пишет class-validator вместо Zod из привычки                          | Low (mitigated в ADR-0002) | ESLint rule `no-class-validator` блокирует                                                                                                                                                                                                                                                                                                                                                                  |
| GlitchTip отстаёт от Sentry API features                                 | Low                        | Используем core features (errors, releases, Web Vitals), не bleeding-edge                                                                                                                                                                                                                                                                                                                                   |
| Timeweb CDN падает / scope-out                                           | Medium                     | Fallback на direct S3 serve без CDN (degraded perf, не downtime); v3 — multi-CDN trigger                                                                                                                                                                                                                                                                                                                    |

---

## 25. Acceptance criteria для DSO-28 closure

- [x] Brainstorm проведён, design spec написан
- [x] ADR-0004 написан (см. `apps/docs/content/adr/0004-frontend-stack-ru.md`)
- [x] Выбраны: meta-framework, app-split, admin/CMS, design-system, data-fetching, forms, promo content, image-opt, real-time, i18n, PWA, testing, monorepo, observability, build tooling
- [x] Обосновано: SSR vs SPA vs SSG mix per surface, deployment topology
- [x] Учтено: RF-CDN, запрет Vercel-only API, 152-ФЗ-compliant
- [x] Open questions с triggers зафиксированы
- [x] Inheritance из ADR-0001/0002/0003 явный
- [x] Acceptance criteria из DSO-28 issue description покрыты
