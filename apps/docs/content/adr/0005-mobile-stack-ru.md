---
title: "ADR-0005 — Mobile Stack для DS Platform [RU]"
description: "DS Platform — медицинская образовательная платформа. Mobile-приложение врача — основной геймплейный фронт (PRD §15): прохождение уроков, клинических..."
lang: ru
---

> **EN:** [`0005-mobile-stack-en.md`](./0005-mobile-stack-en.md) · **RU (this)**

# ADR-0005 — Mobile Stack для DS Platform

**Дата:** 2026-05-14
**Статус:** Accepted
**Связан с:** Plane DSO-29 (`8ecbe6ff-9c29-489c-9cae-d704b1ee7211`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0005-mobile-stack-design-ru.md`
**Наследует:** ADR-0001 (Identity/Auth: IdP shortlist Authentik/Zitadel — TBD per §8 spike), ADR-0002 (Backend: NestJS+REST+Centrifugo+BullMQ+Timeweb storage), ADR-0003 (Postgres17+Drizzle, Cerbos RBAC §5, Redis), ADR-0004 (Frontend: Next.js 15 App Router + 4 apps + Refine + Payload v3)

---

## Context

DS Platform — медицинская образовательная платформа. Mobile-приложение врача — основной геймплейный фронт (PRD §15): прохождение уроков, клинических задач, апгрейд аватара, отслеживание Con/Pul/Au, видео-сериал, вебинары, забеги, оффлайн-обучение.

Hard requirements (digest §8.5, PRD §15 AC):

- iOS 15+ / Android 10+
- Cold start ≤3s→2s, crash-free ≥99→99.7%, 60 FPS gameplay
- Push (APNs+FCM+RuStore), biometric, IAP опция v2
- Полностью оффлайн-уроки v3 MUST + sync ≤5s
- Distribution: **App Store + Google Play + RuStore** (по решению пользователя на brainstorm)

Constraints inherited:

- 152-ФЗ (ПДн в РФ-периметре)
- AI-first development (mainstream-стек, большой LLM-корпус — обязательно)
- Shared schemas/types с web — желательно, intrinsic к выбору

[[feedback_tech_stack_criteria_no_team_skill]] — запрет на «команда умеет», «прототипы на X», «hiring-pool РФ» как pro-аргументы. Прототип `doctor-school-mobile-app-proto/` (Next.js PWA) исключён из влияния на решение.

---

## Decision

> **Mobile phasing (DSO-63 mini-C, 2026-05-18):** Pre-pilot mobile = **responsive web / PWA** (через portal Next.js app, ADR-0004). Native mobile (RN + Expo, ниже §1) — **pilot trigger** (push notifications + offline-капабельности у первой pilot школы или RuStore/App Store distribution). v3 — full offline / gameplay. Решение из этого ADR (RN + Expo как long-term tech) **остаётся актуальным** — фазирование касается timing of build, не tech choice. См. engineering-readiness §"Pre-pilot deployment slice" для полного in-slice / deferred / triggered списка.

### 1. Core: **React Native 0.78+ + Expo SDK 53+ + New Architecture + React 19 + TypeScript strict + Hermes**

Выбран по weighted scoring 13 объективных критериев (см. design spec §2.2). RN — первое место с 75 баллами, Flutter — 71, Native — 67, KMP — 66, Capacitor — 62. Разрыв с Flutter 4 балла — выше уровня шума.

RN выигрывает на:

- **C13 — TypeScript monorepo SSOT reuse** (Zod schemas + api-client types + utils + hooks + observability с web из ADR-0004) — главный intrinsic-differentiator
- C8 AI-friendliness (TS/React — крупнейший LLM-корпус среди UI-стеков)
- C10 Ecosystem health (Meta backing, dogfood Facebook/Instagram)

Разрыв с Flutter по C1 (60 FPS) закрывается Reanimated 3 (UI thread) + Skia (`@shopify/react-native-skia`). Native (C9=0, C13=0) проигрывает на двух кодовых базах при AI-first dev.

**Версии:** RN 0.78 вышел 2025-02-19, содержит React 19 → unified с web (Next.js 15 + React 19, ADR-0004). При старте v1 dev (2026 H2) актуальный Expo SDK — 53+/54+, React 19 unified из коробки. ESLint-guard на React-19-only API в shared packages **не нужен**.

Запрет на legacy архитектуру: Fabric + TurboModules + JSI обязательны.

### 2. Distribution: **App Store + Google Play + RuStore**

Тот же AAB используется для Play и RuStore. PWA-only снят с обсуждения. Apple Developer Program enrollment + RuStore Developer аккаунт — юр-эскалация в DSO-32.

### 3. Navigation/State/Data

- Navigation: **Expo Router v4** (file-based, mental-model совпадает с Next.js App Router из ADR-0004)
- Server state: **Tanstack Query v5** (тот же что web)
- Client/UI state: **Zustand** vanilla
- Forms: **RHF + zodResolver**, схемы из `@ds/schemas` (импортируются буквально)
- API client: типы из **openapi-typescript** через `@ds/api-client` (ADR-0002 §5)
- Realtime: **Centrifugo JS client** (ADR-0002 §7)

**React 19 unified:** RN 0.78+ (Expo SDK 53+) — React 19, как и web (Next.js 15). Shared `packages/hooks` фиксирует `peerDependencies: react>=19.0`. Никаких ESLint-guard'ов на React-19 API в shared packages — обе платформы на React 19. Fallback к peer `>=18.3` — только при вынужденном пине mobile на Expo SDK 52 / RN 0.76 (не планируется).

### 4. UI library

- **NativeWind v4** (Tailwind preset для RN) — тот же config из `@ds/design-system`
- **`react-native-reusables`** (shadcn-style owned-code для RN) — параллель shadcn/ui из ADR-0004
- **`lucide-react-native`** (тот же icon-set)
- **Reanimated 3** (UI thread) + **Moti** для анимаций
- **`lottie-react-native` + `rive-react-native`** оба установлены, выбор per-feature
- **`react-native-video`** (HLS, PiP, offline cache), **FlashList** (virtualized), **`@gorhom/bottom-sheet`** + **`react-native-gesture-handler`**
- **`@shopify/react-native-skia`** — conditional, если v3 DS Clinic карта потребует custom canvas

### 5. Вебинары — трёхслойная архитектура (provider-agnostic)

| Слой                              | Реализация                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A. A/V-стрим                      | `react-native-video` для HLS-pull (предпочтительно); `react-native-webrtc` для interactivity; `react-native-webview` fallback |
| B. Chat + presence + Q&A + polls  | Native RN UI поверх Centrifugo, тот же channel что web                                                                        |
| C. Attendance + НМО timed-buttons | Server-driven; mobile только шлёт события (`viewer_heartbeat`, `tito_button_click`)                                           |

**Hard requirement для DSO-26 brainstorm (webinar provider):** провайдер обязан предоставлять HLS-egress URL. Без этого — WebView-fallback с CSS-зависимостями.

Lesson из digest §9.1 закреплён: presence-ingest server-side, не client-polling.

### 6. Push, biometric, IAP, deep links

- Push: `expo-notifications` (APNs+FCM) + **официальный `react-native-rustore-push-sdk`** от RuStore (`rustore-dev/react-native-rustore-push-sdk`). Custom TurboModule — fallback только если официальный SDK несовместим с New Architecture (валидация first-time на старте v1). Backend — собственный NestJS с тремя провайдерами + BullMQ (ADR-0002). НЕ OneSignal/Pushwoosh (ПДн периметр).
- Biometric: `expo-local-authentication` (Face ID/Touch ID/Android Biometric)
- Secure storage: `expo-secure-store` для сессии — **refresh token TTL = 14d (ADR-0001 §6)**; `react-native-mmkv` для non-secret KV
- IAP: `react-native-iap` (Apple+Google) + **официальный `react-native-rustore-billing-sdk`** — **отложено в v2**, инфраструктура не строится в v1
- Deep links: `expo-linking` + Expo Router (Universal Links + App Links); JSON-config хостится через `apps/promo`
- Referral attribution: native deep link + pasteboard (iOS) + Install Referrer (Android) → NestJS. НЕ AppsFlyer/Adjust (ПДн периметр)

### 7. Offline + sync — three-tier архитектура

Отдельные стратегии для трёх категорий данных:

| Категория                                                       | Стратегия                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Content (видео, текст, тесты) — read-only, server-versioned  | Pull-cache по version-tag через manifest. `expo-file-system` для видео; **`op-sqlite`** (JSI, 5-10× быстрее `expo-sqlite`, FTS5) для текста                                                                                                                                                                                                                                                                                                             |
| B. Progress (текущий шаг, ответы) — write client, eventual sync | **WatermelonDB** + custom NestJS sync-adapter (`POST /sync/push`, `GET /sync/pull?last_pulled_at=...`). **Field-level merge (per-column client-wins)** через `_changes` tracking — это нативный паттерн WatermelonDB, не «LWW по timestamp». Backend **обязан abort push** если запись модифицирована после `lastPulledAt` → клиент делает pull заново. Server-only поля (игнорируются на push): `completed_at`, `nmo_credited_at`, `confirmed_balance` |
| C. Ledger (Con/Pul/Au) — authoritative server                   | **Optimistic local + server reconciliation pattern**. Client пишет в `pending_credits` локально с UUID; UI показывает pending-state; reconnect → `POST /ledger/reconcile-pending` batch → NestJS validate (idempotency, fraud, authority) → confirm/reject                                                                                                                                                                                              |

Default cache: 2 ГБ soft-limit LRU (PRD §15 OQ4 финализирует DSO-26).

Sync trigger: foreground, network reconnect, push "sync-needed", 5-min periodic. Latency target ≤5s после reconnect (digest §5).

**Отказ от альтернатив:**

- **PowerSync Open Edition** (FSL → Apache 2.0 через 2 года) — self-hosted Docker, поддерживает Postgres → 152-ФЗ-совместим. Не выбран по operational-причинам: добавляет отдельный sync-service в infra; меньший LLM-corpus чем WatermelonDB; backend-интеграция требует адаптер к PowerSync-протоколу, тогда как WatermelonDB sync — простой REST-controller в NestJS.
- RxDB — mobile-сторона менее зрелая, меньше RN-документации.
- SQLDelight+Ktor — KMP-Kotlin-Native bridge внутри RN, сложность > выгоды.

CRDT не используется — server всегда authoritative для валюты (Con/Pul/Au), CRDT-машинерия не нужна.

### 8. Build, distribution, CI/CD

- Local dev: **Expo Dev Client** (custom development build, не Expo Go — нужны RuStore SDK+WatermelonDB+react-native-iap)
- Build orchestration: **EAS Build**
- **iOS CI runner: EAS Build cloud (hosted macOS)** — default v1. Free tier = 15 iOS + 15 Android builds/мес; Starter $19/мес = $45 build credits; Production $99/мес = 2 concurrent + $225 credits. 152-ФЗ self-host argument к build не применяется (build не процессит ПДн). Альтернатива — GitHub Actions hosted macOS (~$2.4/build на $0.08/min). Self-host Mac mini / MacStadium — только v2/v3 если EAS станет bottleneck.
- Android CI runner: self-hosted Linux на той же CI инфре что backend (ADR-0002 §8)
- Signing: EAS Credentials (зашифрованный keystore)
- Distribution: 3 канала (App Store Connect, Google Play Console, RuStore Console). Тот же AAB в Play+RuStore.
- OTA: **EAS Update** — только bugfix (Apple Guideline 4.2 compliance). Native-changes — только через store release.
- Versioning: semver + auto-increment buildNumber + Sentry release tag
- Environments: dev/staging/production, три отдельных bundle ID

**Gotcha:** RuStore публикация требует AAB-сборку с native build, в которой линкуются RuStore SDK в `android/app/build.gradle`. EAS Build с `--local` режимом или GitHub Actions Linux runner. **EAS Local Build не поддерживает EAS Secrets** → signing keystore и RuStore-токены передаются через CI environment variables (GitHub Actions secrets / self-hosted CI secret store).

### 9. Testing

- Unit/component: **Vitest/Jest + `@testing-library/react-native`**, coverage ≥80% для `packages/`
- **E2E: Maestro** (YAML, queryless selectors) — выигрывает у Detox/Appium на C8 (AI-friendliness) и speed-to-first-test
- Visual regression: Maestro Studio screenshots (v2 SHOULD)
- Performance: **Flashlight** (Bam.tech) + React DevTools Profiler. Cold-start regression >200ms блокирует merge.
- Manual QA matrix: iPhone 12+, Samsung A-series, Xiaomi mid, Huawei (v2)

### 10. Observability

- Crash + APM + RUM: **`@sentry/react-native` SDK → GlitchTip self-hosted** (MIT, Sentry API-compatible). **Унифицировано с ADR-0004 §15** — один GlitchTip-инстанс на проект, web использует `@sentry/nextjs`, mobile — `@sentry/react-native`.
- Product analytics: **PostHog self-hosted** в РФ-периметре (DSO-31 финализирует)
- Logging: `react-native-logs` локально + GlitchTip breadcrumbs с ПДн-redaction через `@ds/observability`
- Push delivery: серверные метрики NestJS → Prometheus (ADR-0002)

Отказ: Sentry SaaS (ПДн out of РФ); Firebase Crashlytics/Analytics, Mixpanel, Amplitude, DataDog, New Relic, AppsFlyer/Adjust, OneSignal/Pushwoosh — все ПДн периметра.

### 11. Monorepo placement (input для DSO-31)

```
apps/mobile/                # ← Expo RN (this ADR)
packages/
  schemas/                  # Zod (shared 100%)
  api-client/               # openapi-typescript types (shared 100%)
  utils/                    # pure functions (shared 100%)
  observability/            # GlitchTip/PostHog SDK + redaction (shared 100%)
  hooks/                    # React >=19 hooks (shared ~70%)
  design-system/            # Tailwind tokens + lucide (shared base)
  design-system-mobile/     # NativeWind preset + react-native-reusables (mobile-only)
  eslint-config/, tsconfig/ # shared (ADR-0004)
```

DSO-31 финализирует tooling (Turborepo/Nx/pnpm workspaces), CI matrix, version-strategy.

---

## Consequences

### Positive

- Единая React/TS mental-model на mobile+web — консистентный AI-codegen
- Shared Zod + API types + utils + hooks + observability (70-100% reuse от web)
- React 19 unified на mobile+web (RN 0.78 / Expo SDK 53+, Next.js 15) — нет переходного периода
- New Architecture RN убирает legacy bridge issues
- All-OSS-self-host runtime (GlitchTip, PostHog, Centrifugo, NestJS, Postgres) — 152-ФЗ периметр
- Mainstream RN/Expo — максимальный LLM corpus для AI-friendliness
- Тот же AAB в Google Play и RuStore — минус дублирование Android-сборок
- Provider-agnostic вебинары — независим от DSO-26 webinar choice
- Унификация observability с web (один GlitchTip-инстанс)

### Negative

- iOS-сборка зависит от EAS cloud (внешний хостинг) — но build не процессит ПДн → 152-ФЗ-safe
- RuStore push/billing — официальные RN SDK существуют, но требуют валидации на совместимость с New Architecture (first-time проверка)
- Apple Developer Program под санкционным риском (юр DSO-32)
- EAS Local Build не поддерживает EAS Secrets → отдельная процедура управления signing keystore через CI env vars

### Risks

- App Store rejection если провайдер вебинара только iframe → mitigation: hard requirement HLS-egress в DSO-26
- 60 FPS v3 карта DS Clinic не достижим на low-end Android → mitigation: 30 FPS fallback + Skia если потребуется
- WatermelonDB sync conflicts на массовых reconnect-burst → mitigation: BullMQ rate-limit + idempotency UUIDs

---

## Alternatives considered (rejected)

| Alternative                              | Score | Reason                                                                                                                                                                           |
| ---------------------------------------- | :---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter                                  |  71   | C13 SSOT (нет shared Zod/utils/hooks с web) + C8 AI-corpus (Dart) меньше                                                                                                         |
| Native Swift+Kotlin                      |  67   | C9=0 (2 codebases) + C13=0 (нет SSOT с web) × AI uplift                                                                                                                          |
| KMP+CMP                                  |  66   | CMP-iOS только Stable 2025, минимальный LLM corpus, C13=1                                                                                                                        |
| Capacitor + React                        |  62   | 60 FPS gameplay под WebView под угрозой (C1) — главная причина; App Store 4.2 риск для thin-wrappers                                                                             |
| PWA-only                                 |  n/a  | Снято requirement'ом пользователя по distribution (App Store+Play+RuStore)                                                                                                       |
| Tamagui                                  |  n/a  | Дублирует Tailwind, минус C8, минус shared                                                                                                                                       |
| Sentry SaaS                              |  n/a  | ПДн out of РФ. GlitchTip self-hosted покрывает (Sentry API-compatible)                                                                                                           |
| OneSignal/Pushwoosh/RevenueCat/AppsFlyer |  n/a  | Vendor PII outside РФ                                                                                                                                                            |
| Firebase Crashlytics/Analytics           |  n/a  | ПДн Google cloud                                                                                                                                                                 |
| PowerSync                                |  n/a  | Open Edition self-hosted доступен (FSL→Apache 2.0); отказ по operational причинам — отдельный sync-service, меньший LLM-corpus, сложнее backend-интеграция чем WatermelonDB REST |
| Fastlane                                 |  n/a  | Overkill vs EAS                                                                                                                                                                  |
| Detox/Appium                             |  n/a  | C8 проигрывает Maestro                                                                                                                                                           |
| Custom RuStore push/billing TurboModule  |  n/a  | Официальные RN SDK `react-native-rustore-push-sdk` + `react-native-rustore-billing-sdk` существуют; custom — только fallback                                                     |

---

## Open questions (deferred)

| ID     | Q                                                     | Где решается            |
| ------ | ----------------------------------------------------- | ----------------------- |
| OQ-M1  | Lottie vs Rive                                        | Product/Design v1       |
| OQ-M2  | Huawei AppGallery в scope                             | DSO-26                  |
| OQ-M3  | Cache 2 ГБ fixed/configurable                         | DSO-26                  |
| OQ-M4  | IAP инфраструктура v2                                 | DSO-26 monetization     |
| OQ-M5  | WebRTC raise-hand                                     | DSO-26 webinar provider |
| OQ-M6  | Apple Developer Program enrollment                    | DSO-32 юр               |
| OQ-M7  | RuStore Developer аккаунт                             | DSO-32 юр               |
| OQ-M8  | GlitchTip self-host VPS бюджет (общий с web ADR-0004) | DSO-31 infra            |
| OQ-M9  | Sync-window cap (offline >14 дней)                    | Product + DSO-26        |
| OQ-M10 | Retention `pending_credits`                           | DSO-26 ledger spec      |

---

## Связанные ADR / Делегировано

**Наследуется от:**

- ADR-0001 — IdP shortlist (Authentik/Zitadel TBD per §8 spike), OIDC/OAuth2; Cerbos RBAC живёт в ADR-0003 §5; refresh token TTL=14d (mobile per §6)
- ADR-0002 — NestJS REST + Centrifugo + BullMQ + openapi-typescript codegen
- ADR-0003 — Postgres17 + Drizzle + Redis (`pending_credits` table — schema extension через DSO-31)
- ADR-0004 — Tailwind tokens + lucide icons + RHF+Zod + GlitchTip (mobile использует тот же GlitchTip-инстанс)

**Делегировано в другие задачи:**

- **DSO-26 (Product spec):** webinar provider HLS-requirement; cache cap; IAP/monetization scope v2; sync-window cap; `pending_credits` retention; ledger reconciliation спецификация
- **DSO-31 (Engineering readiness):** monorepo tooling (Turborepo/Nx/pnpm); CI matrix mobile; GlitchTip self-host инфра; keystore rotation процедура; `pending_credits` Postgres schema
- **DSO-32 (Legal/Юр):** Apple Developer Program enrollment ($99/год, RF-санкционный риск); RuStore Developer аккаунт; user consent screens 152-ФЗ

**Влияет на (downstream blockers):**

- DSO-26 — hard requirement: webinar provider обязан давать HLS-egress
- DSO-31 — input для monorepo placement (apps/mobile + design-system-mobile)
- v1 implementation (после полного выбора стека) — стартует с этой ADR как mobile-core
