> **EN:** [`0005-mobile-stack-design-en.md`](./0005-mobile-stack-design-en.md) · **RU (this)**

# DS Platform — Mobile Stack Design

**Дата:** 2026-05-14
**Статус:** Design (pre-ADR)
**Plane:** DSO-29 (`8ecbe6ff-9c29-489c-9cae-d704b1ee7211`)
**Milestone:** DSO-24 (выбор tech-стека)
**ADR:** ADR-0005 (this design materialises into it)
**Наследует:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend: NestJS+REST+Centrifugo+BullMQ), ADR-0003 (Postgres17+Drizzle+Cerbos), ADR-0004 (Frontend: Next.js 15 + 4 apps + Refine + Payload)
**Memory constraints:** `feedback_tech_stack_criteria_no_team_skill` — запрещены аргументы «команда умеет», «прототипы на X», «hiring-pool РФ»

---

## 1. Context

DS Platform — медицинская образовательная платформа. Mobile-приложение врача — основной геймплейный фронт (PRD §15): прохождение уроков, клинических задач, апгрейд аватара, отслеживание Con/Pul/Au, видео-сериал, вебинары, забеги, оффлайн-обучение.

### Hard requirements (digest §8.5 + PRD §15 + §9.2)

- Платформы: iOS 15+ / Android 10+
- Cold start: ≤3s (v1) → ≤2s (v3)
- Crash-free: ≥99% (v1) → ≥99.7% (v3)
- 60 FPS gameplay (v3 карта DS Clinic, анимации Con/Pul/Au)
- Push-нотификации (APNs + FCM + RuStore push)
- Biometric unlock (v1 SHOULD)
- Оффлайн-видео (v1 SHOULD)
- **Полностью оффлайн-прохождение уроков (v3 MUST)** с sync разница ≤5s после reconnect
- IAP (опция v2): App Store + Play + RuStore
- Distribution: App Store + Google Play + **RuStore** (mandatory for RF deployment)

### Constraints inherited

- 152-ФЗ — ПДн в РФ-периметре
- ADR-0001 — IdP shortlist (Authentik/Zitadel — TBD per §8 spike), OIDC/OAuth2; Cerbos RBAC живёт в ADR-0003 §5
- ADR-0002 — REST-API из NestJS, Centrifugo для realtime, BullMQ для async
- ADR-0003 — Postgres17 single instance, Drizzle ORM
- ADR-0004 — Next.js 15 для web; Tailwind/shadcn design-system; Zod-схемы как SSOT
- AI-first development — основной механизм разработки

### Bias guard

Прототип `doctor-school-mobile-app-proto/` (Next.js PWA) — **выведен из влияния** на решение по requirement пользователя. PWA-only — снято с обсуждения после фиксации distribution (App Store + Google Play + RuStore).

---

## 2. Decision summary

### 2.1. Stack

**React Native 0.78+ + Expo SDK 53+ + React 19 + New Architecture + TypeScript strict + Hermes**

> Fixed в ADR-0005 §1, §3 (commit 028e8df, 2026-05-15) — версии подняты для унификации React 19 с web-стеком (Next.js 15 + React 19, ADR-0004). Это обеспечивает shared `packages/hooks` единый peer-dep `react>=19` без двух branches. SDK 52 / RN 0.76 упоминаются ниже в §2.5 как fallback на случай критической регрессии 0.78 — не как primary plan.

### 2.2. Weighted comparison — топ-5 кандидатов

| Критерий                                                                                                                  | Вес | Native (Swift+Kotlin) | RN+Expo (new arch) | Flutter | KMP+CMP | Capacitor |
| ------------------------------------------------------------------------------------------------------------------------- | :-: | :-------------------: | :----------------: | :-----: | :-----: | :-------: |
| C1 60 FPS gameplay                                                                                                        |  3  |           3           |         2          |    3    |    3    |     1     |
| C2 Cold start ≤3→2s                                                                                                       |  3  |           3           |         2          |    2    |    2    |     1     |
| C3 Crash-free ≥99→99.7%                                                                                                   |  2  |           3           |         2          |    3    |    3    |     2     |
| C4 Offline+sync v3 MUST                                                                                                   |  3  |           2           |         2          |    2    |    3    |     2     |
| C5 Push (APNs+FCM+RuStore)                                                                                                |  2  |           3           |         3          |    3    |    2    |     2     |
| C6 Biometric                                                                                                              |  1  |           3           |         3          |    3    |    2    |     2     |
| C7 IAP+RuStore                                                                                                            |  2  |           3           |         2          |    2    |    2    |     2     |
| C8 AI-friendliness (LLM corpus, mainstream)                                                                               |  3  |           2           |         3          |    2    |    1    |     3     |
| C9 Single codebase                                                                                                        |  2  |           0           |         3          |    3    |    2    |     3     |
| C10 Ecosystem health (5y)                                                                                                 |  2  |           3           |         3          |    2    |    2    |     2     |
| C11 Store policy (App Store 4.2)                                                                                          |  2  |           3           |         3          |    3    |    3    |     1     |
| C12 RF context                                                                                                            |  2  |           2           |         2          |    3    |    3    |     3     |
| **C13 TypeScript monorepo SSOT reuse (Zod schemas + api-client types + utils + hooks + observability с web из ADR-0004)** |  3  |           0           |         3          |    1    |    1    |     3     |
| **Weighted total**                                                                                                        |     |        **67**         |       **75**       | **71**  | **66**  |  **62**   |

Note: C13 добавлен после первоначального ревью — главный intrinsic-differentiator (shared SSOT с web из ADR-0004) изначально был упомянут только текстом в §2.3, что искажало матрицу. После добавления как полноценного критерия с весом ×3 порядок изменился: RN вышел на первое место с разрывом 4 балла.

### 2.3. Обоснование выбора RN

После корректировки матрицы (C13 как полноценный критерий) RN занимает первое место по сумме (75 vs Flutter 71, разрыв 4 балла — выше уровня шума).

Главные differentiator'ы:

1. **C13 — Shared SSOT с web (ADR-0004) — intrinsic, не «команда умеет»:**
   - `@ds/schemas` (Zod-валидация) — 100% reuse
   - `@ds/api-client` (типы из openapi-typescript) — 100% reuse
   - `@ds/utils` (pure-функции, расчёт Con/Pul/Au) — 100% reuse
   - `@ds/hooks` (React 19, per ADR-0005 §3) — ~70% reuse
   - `@ds/observability` (GlitchTip/PostHog обёртки) — 100% reuse
2. **C8 — AI-friendliness:** TypeScript/React — крупнейший LLM-корпус среди UI-стеков.
3. **C1 (60 FPS) разрыв с Flutter закрывается** на практике: Reanimated 3 (UI thread animations) + `@shopify/react-native-skia` (2D canvas) — достижим 60 FPS для v3 карты DS Clinic.

### 2.4. Отказ от альтернатив

| Что                         | Почему                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flutter                     | Меньший AI-corpus (Dart), нет shared Zod/types с web                                                                                                                                             |
| Native Swift+Kotlin         | Две кодовые базы (C9=0) — AI uplift × 2                                                                                                                                                          |
| KMP + Compose Multiplatform | CMP-iOS стабилизирован только 2025, минимальный LLM-corpus                                                                                                                                       |
| Capacitor + React           | 60 FPS gameplay (C1) под WebView под угрозой при v3 карте; App Store 4.2 риск применим к thin-wrappers без значимых native-features — мы бы добавили native-слой, но C1 — главная причина отказа |

---

## 3. Core stack (детали)

| Слой        | Выбор                                                                                              | Обоснование                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | **RN 0.78+** с New Architecture (Fabric + TurboModules + JSI)                                      | Legacy bridge deprecated; стабильное 60 FPS требует Fabric. RN 0.78 вышел 2025-02-19, содержит React 19 → unified с web (Next.js 15 + React 19, ADR-0004). |
| JS engine   | Hermes                                                                                             | -30% bundle vs JSC, pre-compiled bytecode                                                                                                                  |
| Tooling     | **Expo SDK 53+** (актуальная стабильная на момент v1 dev; SDK 54/55 ожидаются к старту реализации) | Включает RN 0.78+ и React 19. Managed → Bare если потребуется. Config Plugins, EAS, Expo Router.                                                           |
| Язык        | TypeScript strict                                                                                  | Тот же tsconfig что `apps/portal` (ADR-0004)                                                                                                               |
| Lint/Format | ESLint + Prettier из `packages/eslint-config`                                                      | Shared с web, консистентный feedback для AI-агентов                                                                                                        |

**Gotcha:** RuStore публикация требует AAB-сборку с native build, в которой линкуется RuStore SDK в `android/app/build.gradle`. Подходит EAS Build с `--local` режимом или GitHub Actions self-hosted Linux runner. EAS Build cloud для Android с RuStore-зависимостями работает, но secrets/keystore передаются через CI env vars (см. §9.3 — EAS Local Build не поддерживает EAS Secrets).

---

## 4. Navigation, state, data

| Слой            | Выбор                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Navigation      | **Expo Router v4** (file-based, поверх React Navigation 7)             |
| Server state    | **Tanstack Query v5** (тот же что web, ADR-0004 §5)                    |
| Client/UI state | **Zustand** (vanilla)                                                  |
| Forms           | **React Hook Form + zodResolver** — те же Zod-схемы из `@ds/schemas`   |
| API client      | **`@ds/api-client`** (openapi-typescript types) + native fetch         |
| Realtime        | **Centrifugo JS client** (тот же channel pattern что web, ADR-0002 §7) |

### 4.1. React 19 unified

RN 0.78 (вышел 2025-02-19) и Expo SDK 53+ включают React 19. Web (Next.js 15, ADR-0004) — тоже React 19. При старте v1 dev (вторая половина 2026) обе платформы стартуют на React 19 → **unified из коробки**, ESLint-guard на «no React-19 API» в shared packages **не нужен**.

`packages/hooks` указывает `peerDependencies: { react: ">=19.0" }`. Все shared packages свободно используют React 19 API (Actions, `use()`).

**Fallback план** (если по какой-то причине придётся пинить Expo SDK 52 / RN 0.76 на React 18): тогда `peerDependencies: { react: ">=18.3" }` + ESLint guard блокирует React-19-only API. Это временная мера на время апгрейда, не permanent architecture.

---

## 5. UI library + design-system

| Слой                 | Выбор                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Styling              | **NativeWind v4** — тот же Tailwind config из `@ds/design-system`                                                                                                |
| Component primitives | **`react-native-reusables`** — shadcn-style owned-code copy-paste                                                                                                |
| Icons                | **`lucide-react-native`** (тот же icon-set что web)                                                                                                              |
| Animation            | **Reanimated 3** (UI thread) + **Moti** (декларативный wrapper)                                                                                                  |
| Lottie / Rive        | **Один из двух** — Lottie ИЛИ Rive, не оба в bundle. Решение до старта v1 dev (PRD §15 OQ3 → OQ-M1 closing-required). Cold start ≤3s блокирует «оба установлены» |
| Video                | **`react-native-video`** (HLS, DASH, ExoPlayer/AVPlayer, PiP, background audio, offline cache)                                                                   |
| Lists                | **FlashList** (Shopify) — виртуализация с recycle pool                                                                                                           |
| Sheets/Gestures      | **`@gorhom/bottom-sheet` + `react-native-gesture-handler`**                                                                                                      |
| Skia (conditional)   | **`@shopify/react-native-skia`** — добавить если v3 DS Clinic карта потребует custom canvas                                                                      |

### 5.1. Что переиспользуется из `@ds/design-system`

- Tailwind tokens (colors, spacing, typography) — 100%
- NativeWind preset мостит tokens в RN-styles
- lucide-react-native — 1:1 импорт по имени

### 5.2. Что не переиспользуется

- shadcn web-компоненты `<Button>`, `<Dialog>` — mobile-версии в `@ds/design-system-mobile`. API props стараемся держать совместимым.

### 5.3. Отказ

- **Tamagui** — дублирует Tailwind, минус AI-friendliness, минус shared с web.
- **React Native Paper / Elements** — pre-built Material/iOS, ограничивает brand UX.

---

## 6. Вебинары

Контекст: провайдер вебинаров (МТС Линк / Webinar.ru / BigBlueButton) — отдельный brainstorm DSO-26. Mobile должно быть provider-agnostic. Lesson из digest §9.1: presence-ingest server-side, не client-polling.

### 6.1. Архитектурное разделение на 3 слоя

| Слой                                         | Реализация                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **A. A/V-стрим**                             | Зависит от типа провайдера (см. 6.2)                                                        |
| **B. Chat + presence + Q&A + polls**         | Native RN UI поверх Centrifugo (ADR-0002 §7)                                                |
| **C. Attendance ledger + НМО timed-buttons** | Server-side (NestJS); mobile только генерит события `viewer_heartbeat`, `tito_button_click` |

### 6.2. Стрим — три паттерна

| Тип провайдера                      | Паттерн                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **HLS/DASH-pull**                   | `react-native-video` нативный плеер. **Предпочтительный путь.** Pull URL подписан JWT.                |
| **WebRTC** (interactivity required) | `react-native-webrtc` + provider JS-SDK                                                               |
| **Iframe-only** (fallback)          | `react-native-webview` с CSS-injection. **Худший вариант** — WKWebView ограничения на background/PiP. |

**Hard requirement для DSO-26:** провайдер должен предоставлять HLS-egress URL. Без этого — WebView-fallback с провайдерскими CSS-зависимостями.

### 6.3. Chat через Centrifugo

Тот же channel `webinar:{event_id}` что web-кабинет. UI чата — нативный RN: FlashList для сообщений, BottomSheet overlay, RHF для отправки.

### 6.4. Attendance — server-driven

Mobile НЕ считает время сам. Шлёт:

- `viewer_heartbeat` каждые 30s
- `tito_button_click` (титровальный объект)
- `webinar_left`

NestJS валидирует ≥90 мин + 2 титра (digest §9.2), начисляет НМО.

### 6.5. IAP при вебинарах

PRD §15 v2 «CTA вебинар за 200 Au» — внутренние баллы, IAP не нужен. Реальные деньги (донат, merch) — отдельный flow v2 (см. §7).

---

## 7. Push, biometric, IAP, deep links

| Слой                 | Выбор                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push                 | `expo-notifications` (APNs/FCM) + **официальный `react-native-rustore-push-sdk`** от RuStore. Custom TurboModule — только fallback если официальный SDK несовместим с New Architecture (проверить на старте v1) |
| Push backend         | NestJS с тремя провайдерами + BullMQ (ADR-0002 §6). Не OneSignal/Pushwoosh — ПДн периметр                                                                                                                       |
| Biometric            | `expo-local-authentication` (Face ID / Touch ID / Android Biometric)                                                                                                                                            |
| Secure storage       | `expo-secure-store` (Keychain/Keystore) для сессии — **refresh token TTL = 14d (ADR-0001 §6)**; `react-native-mmkv` для non-secret KV                                                                           |
| IAP (Apple+Google)   | `react-native-iap` — **в v2**, не v1                                                                                                                                                                            |
| IAP RuStore          | **Официальный `react-native-rustore-billing-sdk`** от RuStore — **в v2**. Custom TurboModule — только fallback                                                                                                  |
| Deep links           | `expo-linking` + Expo Router (Universal Links + App Links); JSON-config хостится через `apps/promo`                                                                                                             |
| Referral attribution | Native deep link state + pasteboard (iOS) + Install Referrer (Android) → NestJS атрибуция. НЕ AppsFlyer/Adjust (ПДн периметр)                                                                                   |

---

## 8. Offline strategy + sync

PRD §15 + digest §5: v1 SHOULD оффлайн-видео; v3 MUST полное оффлайн-прохождение уроков с sync ≤5s.

### 8.1. Разделение на 3 категории данных

| Категория                                                  | Природа                           | Стратегия                                |
| ---------------------------------------------------------- | --------------------------------- | ---------------------------------------- |
| **A. Content** (видео, текст, тесты, флэшкарды, глоссарий) | Read-only, версионируется backend | Pull-cache по version-tag                |
| **B. Progress** (текущий шаг, ответы, время на видео)      | Write на клиенте, eventual sync   | Local-first SQLite + event-log           |
| **C. Ledger** (Con/Pul/Au transactions)                    | **Authoritative на сервере**      | Optimistic local + server reconciliation |

### 8.2. Content cache

| Компонент     | Выбор                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Видео         | `expo-file-system` / `react-native-fs` (resume, chunked)                                |
| Текст/тесты   | **`op-sqlite`** (JSI-based, 5-10× быстрее `expo-sqlite`, FTS5)                          |
| Manifest      | NestJS `GET /lessons/{id}/manifest` → `{content_version, files: [{url, sha256, size}]}` |
| Default объём | 2 ГБ soft-limit с LRU-eviction (PRD §15 OQ4 — финализация через DSO-26)                 |

### 8.3. Progress sync — WatermelonDB

- **WatermelonDB** поверх SQLite. Reactive observables → UI auto-update.
- Sync API: `POST /sync/push` (client batch), `GET /sync/pull?last_pulled_at=...`.
- **Conflict resolution: field-level merge (per-column client-wins)** — WatermelonDB трекит изменённые поля через колонку `_changes` (массив имён модифицированных полей). При sync server применяет update **только к этим конкретным полям**, остальные поля остаются server-state. Это не «LWW по client-timestamp» — это per-column resolution.
- **Backend protocol — обязательное abort-on-stale-write:** если push-батч содержит запись, изменённую на сервере после `lastPulledAt` клиента → backend **отклоняет push с ошибкой**, клиент делает pull заново перед повторной попыткой push. Без этой проверки sync-pipeline тихо теряет server-side изменения.
- Server-only поля (клиент не может писать): `completed_at`, `nmo_credited_at`, `confirmed_balance` — игнорируются на push, всегда читаются с server.
- Sync trigger: foreground, network reconnect, push «sync-needed», 5-min periodic при активности.

**Почему WatermelonDB, не альтернативы:**

| Альтернатива           | Honest reason for rejection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PowerSync**          | **PowerSync Open Edition** (FSL → Apache 2.0 через 2 года) **есть** как self-hosted Docker, поддерживает Postgres → 152-ФЗ совместим. Отказ по другим причинам: (1) добавляет отдельный sync-service-component в infra (ещё один процесс к мониторингу/бекапам); (2) меньший LLM-corpus для AI-агентов чем WatermelonDB; (3) backend-интеграция с NestJS REST требует адаптер к PowerSync protocol, тогда как WatermelonDB sync-protocol — простой REST который пишется как обычный NestJS controller. Trade-off — выбран WatermelonDB как проще-операционно. |
| RxDB                   | Mobile-сторона менее зрелая чем WatermelonDB; меньше RN-specific документации                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SQLDelight+Ktor bridge | KMP-Kotlin Native layer внутри RN — сложность > выгоды                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 8.4. Ledger reconciliation pattern

**Optimistic local credit + Server reconciliation** (НЕ CRDT — не тот use-case).

1. Оффлайн action → `pending_credit: {amount, source, client_event_id, client_timestamp}` в локальный event-log.
2. UI показывает «+10 Con» **с pending-state** (визуально отличный — серый / opacity 0.6).
3. При reconnect → `POST /ledger/reconcile-pending` batch.
4. NestJS validate:
   - Lesson и task существуют, врач имел право
   - Idempotency по `client_event_id`
   - Applies authoritative entry в `ledger`, возвращает confirmed balance
5. Mobile получает confirmation → убирает pending state.
6. Reject (fraud-check, invalidated lesson) → откат локально + toast.

**Гарантии:**

- Idempotency: UUID на event
- Authority: client never writes `ledger`, только `pending_credits`
- Visibility: user видит pending vs confirmed
- Recovery: 10 fail → `sync_failed` state + UI explanation

### 8.5. Backend hooks

- BullMQ обрабатывает `sync-push` batch'и асинхронно (ADR-0002 §6)
- Postgres-таблица `pending_credits` отдельно от `ledger` (DSO-31 schema extension)
- Centrifugo `ledger.updated` → TanstackQuery `invalidateQueries` → UI refresh

---

## 9. Build, distribution, CI/CD

| Слой                | Выбор                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Local dev           | Expo Dev Client (custom development build)                                                        |
| Build orchestration | EAS Build (Expo Application Services)                                                             |
| iOS CI runner       | **EAS Build cloud** (hosted macOS) — default v1; альтернатива GitHub Actions hosted macOS minutes |
| Android CI runner   | Self-hosted Linux runner (та же CI инфра что backend, ADR-0002 §8)                                |
| Signing             | EAS Credentials (зашифрованный keystore)                                                          |
| Distribution        | 3 канала: App Store Connect, Google Play Console, RuStore Console — **тот же AAB** в Play+RuStore |
| OTA                 | EAS Update — только bugfix (Apple Guideline 4.2 compliance)                                       |
| Versioning          | Semver + auto-increment buildNumber + Sentry release tag                                          |
| Environments        | dev / staging / production через Expo build profiles; 3 bundle ID                                 |

### 9.1. iOS runner — пересмотр

Build-этап не процессит ПДн (только source + assets) → 152-ФЗ self-host argument не применяется к build pipeline.

- **EAS Build cloud:** Free tier = 15 iOS builds + 15 Android builds в месяц (раздельно). Starter $19/мес = $45 build credits (не «priority»). Production $99/мес = 2 concurrent builds + $225 credits. Priority builds — отдельная фича Production-плана. Default v1 — Starter ($19/мес).
- **GitHub Actions hosted macOS:** $0.08/min × ~30 min build ≈ $2.4/build, или бесплатно если у репо GitHub Pro/Team с включёнными macOS minutes. Альтернатива.
- **Self-host Mac mini / MacStadium:** только если v2/v3 EAS станет bottleneck.

### 9.2. EAS Local Build secrets caveat

`eas build --local` имеет ограничения: **не поддерживает EAS Secrets с visibility=Secret**, не поддерживает remote caching, не поддерживает `--platform all`.

Для RuStore-сборки на self-hosted Linux runner с локальным RuStore SDK: signing keystore (Android `.jks`) и RuStore-токены передаются через **CI environment variables** (GitHub Actions secrets / self-hosted CI secret store), **не** через EAS Credentials. Документировать процедуру ротации ключей в DSO-31.

### 9.3. Release flow

1. PR merge → CI: unit + e2e (Maestro на cloud Mac)
2. Tag `mobile-vX.Y.Z` → CI build обеих платформ → upload в 3 стора как draft
3. Manual promote: TestFlight Internal → External Beta → Production. Тот же AAB в RuStore.
4. Sentry release auto-create + source maps upload

### 9.4. Эскалации (DSO-31 / DSO-32)

- Apple Developer Program enrollment ($99/год, RF-санкции) — **DSO-32 юр**
- RuStore Developer аккаунт (RF юр.лицо через ЕСИА) — **DSO-32 юр**
- EAS subscription budget — **DSO-31 ops**

### 9.5. Отказ

- Fastlane — overkill, EAS покрывает 90%
- CodePush — Microsoft App Center deprecated 2024
- Cloud-сборки full automation — manual promote безопаснее для compliance

---

## 10. Testing

| Уровень           | Инструмент                                               | When                                                 |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Unit (logic)      | Vitest или Jest                                          | v1 MUST; coverage ≥80% для `packages/`               |
| Component (RN UI) | `@testing-library/react-native` + Jest                   | v1 SHOULD                                            |
| **E2E**           | **Maestro** (YAML, queryless selectors)                  | v1 MUST для онбординга / урока / sync                |
| Visual regression | Maestro Studio + screenshots                             | v2 SHOULD                                            |
| Performance       | Flashlight (Bam.tech) + React DevTools Profiler          | v1 MUST в CI (cold-start regression блокирует merge) |
| Manual QA matrix  | Spreadsheet: iPhone 12+/Samsung A/Xiaomi mid/Huawei (v2) | v1 MUST pre-release                                  |

### 10.1. Maestro vs Detox vs Appium

| Param           | Maestro          | Detox           | Appium          |
| --------------- | ---------------- | --------------- | --------------- |
| Setup           | YAML, минуты     | JS harness, дни | дни             |
| AI-friendliness | 3 (YAML for LLM) | 2 (JS DSL)      | 1 (Java/Python) |
| Flakiness       | Low (auto-wait)  | Medium          | High            |
| New arch RN     | ✅               | ✅ (with lag)   | ✅              |

Maestro выигрывает на C8 + speed-to-first-test.

### 10.2. CI integration

- Unit/component → каждый PR (Linux runner, ~30s)
- E2E Maestro → main branch + tag (iOS Simulator cloud Mac + Android Emulator Linux), 5-10 мин
- Performance → tag + nightly. Flashlight JSON → comparison baseline

---

## 11. Observability

| Что               | Инструмент                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash reporting   | **`@sentry/react-native` SDK** → **GlitchTip self-hosted** в РФ-периметре (MIT-licensed, Sentry API-compatible — унификация с ADR-0004 §15 web) |
| APM / Performance | GlitchTip (same instance, через тот же SDK)                                                                                                     |
| Logging           | `react-native-logs` локально + GlitchTip breadcrumbs с ПДн-redaction через `@ds/observability`                                                  |
| Product analytics | **PostHog self-hosted** в РФ-периметре (DSO-31 финализирует)                                                                                    |
| RUM               | GlitchTip covers (cold start, FPS, transitions)                                                                                                 |
| Push delivery     | Серверные метрики NestJS → Prometheus (ADR-0002)                                                                                                |

**Унификация с web (ADR-0004 §15):** mobile и web используют **один self-hosted GlitchTip-instance** через официальный Sentry SDK (`@sentry/react-native` для mobile, `@sentry/nextjs` для web). GlitchTip — MIT, on-prem free, поддерживает Sentry-протокол → SDK переключается через `dsn` config. Sentry SaaS отвергается из-за ПДн периметра. Sentry self-hosted (FSL license) — допустим, но GlitchTip даёт MIT и единственный observability-backend на проект.

### 11.1. Отказ

- Firebase Crashlytics, Firebase Analytics, Mixpanel, Amplitude, DataDog, New Relic — все SaaS/USA cloud, ПДн периметр

### 11.2. Privacy

- Все события проходят через `@ds/observability` redaction middleware (`email → hash`, `phone → null`)
- User opt-out в Settings (152-ФЗ)
- Consent screen в onboarding — общий компонент c web

### 11.3. Эскалация

- GlitchTip self-hosted VPS (общий с web из ADR-0004 §15) — **DSO-31 infra**

---

## 12. Monorepo placement (input для DSO-31)

```
apps/
  promo/, portal/, admin/, cms/   # web (ADR-0004)
  mobile/                          # ← Expo RN (this ADR)
packages/
  schemas/                         # Zod (shared)
  api-client/                      # openapi-typescript types (shared)
  utils/                           # pure functions (shared)
  observability/                   # GlitchTip/PostHog SDK + redaction (shared)
  hooks/                           # React >=19 hooks (shared, fallback >=18.3 при SDK 52 pin)
  design-system/                   # Tailwind tokens + lucide (shared base)
  design-system-mobile/            # NativeWind preset + react-native-reusables
  eslint-config/, tsconfig/        # shared
```

DSO-31 финализирует tooling (Turborepo / Nx / pnpm workspaces), CI matrix, version-strategy.

---

## 13. Open questions

| ID     | Q                                                     | Где решается            |
| ------ | ----------------------------------------------------- | ----------------------- |
| OQ-M1  | Lottie vs Rive                                        | Product/Design v1       |
| OQ-M2  | Huawei AppGallery в scope                             | DSO-26 product spec     |
| OQ-M3  | Cache 2 ГБ fixed / configurable                       | DSO-26                  |
| OQ-M4  | IAP инфраструктура v2 monetization                    | DSO-26                  |
| OQ-M5  | WebRTC raise-hand вебинары                            | DSO-26 webinar provider |
| OQ-M6  | Apple Developer Program enrollment                    | DSO-32 юр               |
| OQ-M7  | RuStore Developer аккаунт                             | DSO-32 юр               |
| OQ-M8  | GlitchTip self-host VPS бюджет (общий с web ADR-0004) | DSO-31 infra            |
| OQ-M9  | Sync-window cap (offline >14 дней)                    | Product + DSO-26        |
| OQ-M10 | Retention `pending_credits`                           | DSO-26 ledger spec      |

---

## 14. Consequences

### Positive

- Один React/TS mental-model на mobile+web; AI-агенты пишут консистентный код
- Shared Zod schemas + API types + utils + hooks + observability (~70-100% reuse)
- New Architecture RN снимает legacy bridge issues
- All-OSS-self-host runtime stack (GlitchTip, PostHog, Centrifugo, NestJS, Postgres) — 152-ФЗ периметр
- Tooling RN/Expo — mainstream, максимальный LLM corpus для AI-friendliness

### Negative

- iOS-сборка зависит от EAS cloud (хостинг внешний) — но build не процессит ПДн → 152-ФЗ-safe
- RuStore push/billing — официальные RN SDK от RuStore, но требуют валидации на совместимость с New Architecture (проверка first-time)
- Apple Developer Program под санкционным риском — юр-эскалация DSO-32
- EAS Local Build не поддерживает EAS Secrets → signing keystore передаётся через CI env vars (отдельная процедура ротации)

### Risks

- App Store rejection из-за WebView вебинара (если провайдер только iframe-mode) → mitigation: hard requirement HLS-egress в DSO-26
- 60 FPS v3 карта DS Clinic не достижим на низком Android → mitigation: fallback на 30 FPS на устройствах ниже benchmark, Skia если потребуется custom canvas
- WatermelonDB sync conflicts на массовых reconnect-burst → mitigation: BullMQ rate-limit, idempotency keys

---

## 15. Что не выбираем (negative decisions)

| Что                                      | Почему                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flutter                                  | C8 AI-friendliness (Dart < TS), нет shared schemas с web                                                                                                                 |
| Native Swift+Kotlin                      | 2 codebases × AI uplift cost                                                                                                                                             |
| KMP + CMP                                | C8 + молодость CMP-iOS (Stable 2025)                                                                                                                                     |
| Capacitor                                | 60 FPS gameplay под WebView под угрозой; App Store 4.2 риск для thin-wrappers без native-features (мы бы добавили native-слой, но gameplay-FPS — главная причина отказа) |
| Tamagui                                  | Дублирует Tailwind, минус C8, минус shared                                                                                                                               |
| OneSignal/Pushwoosh/RevenueCat/AppsFlyer | Vendor-managed PII outside РФ-периметра                                                                                                                                  |
| Firebase Crashlytics/Analytics           | ПДн Google cloud                                                                                                                                                         |
| Fastlane                                 | Overkill vs EAS                                                                                                                                                          |
| Detox/Appium                             | C8 проигрывает Maestro                                                                                                                                                   |
