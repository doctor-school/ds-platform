> **EN (this)** · **RU:** [`0005-mobile-stack-design-ru.md`](./0005-mobile-stack-design-ru.md)

# DS Platform — Mobile Stack Design

**Date:** 2026-05-14
**Status:** Design (pre-ADR)
**Plane:** DSO-29 (`8ecbe6ff-9c29-489c-9cae-d704b1ee7211`)
**Milestone:** DSO-24 (tech stack selection)
**ADR:** ADR-0005 (this design materialises into it)
**Inherits:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend: NestJS+REST+Centrifugo+BullMQ), ADR-0003 (Postgres17+Drizzle+Cerbos), ADR-0004 (Frontend: Next.js 15 + 4 apps + Refine + Payload)
**Memory constraints:** `feedback_tech_stack_criteria_no_team_skill` — arguments "team knows X", "prototypes on X", "RF hiring-pool" are prohibited

---

## 1. Context

DS Platform is a medical education platform. The doctor mobile app is the primary gameplay front-end (PRD §15): lesson walkthroughs, clinical tasks, avatar upgrades, Con/Pul/Au tracking, video series, webinars, runs (zabegi / забеги), offline learning.

### Hard requirements (digest §8.5 + PRD §15 + §9.2)

- Platforms: iOS 15+ / Android 10+
- Cold start: ≤3s (v1) → ≤2s (v3)
- Crash-free: ≥99% (v1) → ≥99.7% (v3)
- 60 FPS gameplay (v3 DS Clinic map, Con/Pul/Au animations)
- Push notifications (APNs + FCM + RuStore push)
- Biometric unlock (v1 SHOULD)
- Offline video (v1 SHOULD)
- **Fully offline lesson walkthrough (v3 MUST)** with sync delta ≤5s after reconnect
- IAP (option v2): App Store + Play + RuStore
- Distribution: App Store + Google Play + **RuStore** (mandatory for RF (Russian Federation) deployment)

### Constraints inherited

- Federal Law 152-FZ — personal data (PD) within RF zone
- ADR-0001 — IdP shortlist (Authentik/Zitadel — TBD per §8 spike), OIDC/OAuth2; Cerbos RBAC lives in ADR-0003 §5
- ADR-0002 — REST API from NestJS, Centrifugo for realtime, BullMQ for async
- ADR-0003 — Postgres17 single instance, Drizzle ORM
- ADR-0004 — Next.js 15 for web; Tailwind/shadcn design-system; Zod schemas as SSOT
- AI-first development — primary development mechanism

### Bias guard

The prototype `doctor-school-mobile-app-proto/` (Next.js PWA) has been **excluded from influencing** this decision per user requirement. PWA-only has been removed from consideration after distribution was fixed (App Store + Google Play + RuStore).

---

## 2. Decision summary

### 2.1. Stack

**React Native 0.78+ + Expo SDK 53+ + React 19 + New Architecture + TypeScript strict + Hermes**

> Fixed in ADR-0005 §1, §3 (commit 028e8df, 2026-05-15) — versions bumped to unify React 19 with the web stack (Next.js 15 + React 19, ADR-0004). This gives shared `packages/hooks` a single peer-dep `react>=19` without two branches. SDK 52 / RN 0.76 are mentioned below in §2.5 as a fallback in case of a critical regression in 0.78 — not as the primary plan.

### 2.2. Weighted comparison — top-5 candidates

| Criterion                                                                                                                             | Weight | Native (Swift+Kotlin) | RN+Expo (new arch) | Flutter | KMP+CMP | Capacitor |
| ------------------------------------------------------------------------------------------------------------------------------------- | :----: | :-------------------: | :----------------: | :-----: | :-----: | :-------: |
| C1 60 FPS gameplay                                                                                                                    |   3    |           3           |         2          |    3    |    3    |     1     |
| C2 Cold start ≤3→2s                                                                                                                   |   3    |           3           |         2          |    2    |    2    |     1     |
| C3 Crash-free ≥99→99.7%                                                                                                               |   2    |           3           |         2          |    3    |    3    |     2     |
| C4 Offline+sync v3 MUST                                                                                                               |   3    |           2           |         2          |    2    |    3    |     2     |
| C5 Push (APNs+FCM+RuStore)                                                                                                            |   2    |           3           |         3          |    3    |    2    |     2     |
| C6 Biometric                                                                                                                          |   1    |           3           |         3          |    3    |    2    |     2     |
| C7 IAP+RuStore                                                                                                                        |   2    |           3           |         2          |    2    |    2    |     2     |
| C8 AI-friendliness (LLM corpus, mainstream)                                                                                           |   3    |           2           |         3          |    2    |    1    |     3     |
| C9 Single codebase                                                                                                                    |   2    |           0           |         3          |    3    |    2    |     3     |
| C10 Ecosystem health (5y)                                                                                                             |   2    |           3           |         3          |    2    |    2    |     2     |
| C11 Store policy (App Store 4.2)                                                                                                      |   2    |           3           |         3          |    3    |    3    |     1     |
| C12 RF context                                                                                                                        |   2    |           2           |         2          |    3    |    3    |     3     |
| **C13 TypeScript monorepo SSOT reuse (Zod schemas + api-client types + utils + hooks + observability shared with web from ADR-0004)** |   3    |           0           |         3          |    1    |    1    |     3     |
| **Weighted total**                                                                                                                    |        |        **67**         |       **75**       | **71**  | **66**  |  **62**   |

Note: C13 was added after the initial review — the main intrinsic differentiator (shared SSOT with web from ADR-0004) was originally mentioned only as text in §2.3, which skewed the matrix. After adding it as a full criterion with weight ×3 the ranking changed: RN moved to first place with a 4-point gap.

### 2.3. Rationale for choosing RN

After the matrix correction (C13 as a full criterion) RN ranks first overall (75 vs Flutter 71, gap 4 points — above noise level).

Main differentiators:

1. **C13 — Shared SSOT with web (ADR-0004) — intrinsic, not "team knows":**
   - `@ds/schemas` (Zod validation) — 100% reuse
   - `@ds/api-client` (types from openapi-typescript) — 100% reuse
   - `@ds/utils` (pure functions, Con/Pul/Au calculations) — 100% reuse
   - `@ds/hooks` (React 19, per ADR-0005 §3) — ~70% reuse
   - `@ds/observability` (GlitchTip/PostHog wrappers) — 100% reuse
2. **C8 — AI-friendliness:** TypeScript/React — the largest LLM corpus among UI stacks.
3. **C1 (60 FPS) gap with Flutter is closed** in practice: Reanimated 3 (UI thread animations) + `@shopify/react-native-skia` (2D canvas) — 60 FPS is achievable for the v3 DS Clinic map.

### 2.4. Alternatives rejected

| What                        | Why                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter                     | Smaller AI corpus (Dart), no shared Zod/types with web                                                                                                                                                                |
| Native Swift+Kotlin         | Two codebases (C9=0) — AI uplift × 2                                                                                                                                                                                  |
| KMP + Compose Multiplatform | CMP-iOS stabilised only in 2025, minimal LLM corpus                                                                                                                                                                   |
| Capacitor + React           | 60 FPS gameplay (C1) under WebView at risk on v3 map; App Store 4.2 risk applies to thin-wrappers without meaningful native features — we would have added a native layer, but C1 is the primary reason for rejection |

---

## 3. Core stack (details)

| Layer       | Choice                                                                                        | Rationale                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | **RN 0.78+** with New Architecture (Fabric + TurboModules + JSI)                              | Legacy bridge deprecated; stable 60 FPS requires Fabric. RN 0.78 released 2025-02-19, ships React 19 → unified with web (Next.js 15 + React 19, ADR-0004). |
| JS engine   | Hermes                                                                                        | -30% bundle vs JSC, pre-compiled bytecode                                                                                                                  |
| Tooling     | **Expo SDK 53+** (current stable at v1 dev start; SDK 54/55 expected by implementation start) | Ships RN 0.78+ and React 19. Managed → Bare if needed. Config Plugins, EAS, Expo Router.                                                                   |
| Language    | TypeScript strict                                                                             | Same tsconfig as `apps/portal` (ADR-0004)                                                                                                                  |
| Lint/Format | ESLint + Prettier from `packages/eslint-config`                                               | Shared with web, consistent feedback for AI agents                                                                                                         |

**Gotcha:** RuStore publishing requires an AAB build with a native build that links the RuStore SDK in `android/app/build.gradle`. EAS Build with `--local` mode or a GitHub Actions self-hosted Linux runner works. EAS Build cloud for Android with RuStore dependencies works, but secrets/keystore are passed via CI env vars (see §9.3 — EAS Local Build does not support EAS Secrets).

---

## 4. Navigation, state, data

| Layer           | Choice                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Navigation      | **Expo Router v4** (file-based, on top of React Navigation 7)           |
| Server state    | **Tanstack Query v5** (same as web, ADR-0004 §5)                        |
| Client/UI state | **Zustand** (vanilla)                                                   |
| Forms           | **React Hook Form + zodResolver** — same Zod schemas from `@ds/schemas` |
| API client      | **`@ds/api-client`** (openapi-typescript types) + native fetch          |
| Realtime        | **Centrifugo JS client** (same channel pattern as web, ADR-0002 §7)     |

### 4.1. React 19 unified

RN 0.78 (released 2025-02-19) and Expo SDK 53+ ship React 19. Web (Next.js 15, ADR-0004) also runs React 19. At v1 dev start (second half of 2026) both platforms start on React 19 → **unified out of the box**, no ESLint guard on "no React-19 API" in shared packages is **needed**.

`packages/hooks` declares `peerDependencies: { react: ">=19.0" }`. All shared packages freely use React 19 APIs (Actions, `use()`).

**Fallback plan** (if for some reason Expo SDK 52 / RN 0.76 must be pinned to React 18): then `peerDependencies: { react: ">=18.3" }` + ESLint guard blocks React-19-only APIs. This is a temporary measure during the upgrade, not permanent architecture.

---

## 5. UI library + design-system

| Layer                | Choice                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Styling              | **NativeWind v4** — same Tailwind config from `@ds/design-system`                                                                                                        |
| Component primitives | **`react-native-reusables`** — shadcn-style owned-code copy-paste                                                                                                        |
| Icons                | **`lucide-react-native`** (same icon set as web)                                                                                                                         |
| Animation            | **Reanimated 3** (UI thread) + **Moti** (declarative wrapper)                                                                                                            |
| Lottie / Rive        | **One of the two** — Lottie OR Rive, not both in the bundle. Decision before v1 dev start (PRD §15 OQ3 → OQ-M1 closing-required). Cold start ≤3s blocks "both installed" |
| Video                | **`react-native-video`** (HLS, DASH, ExoPlayer/AVPlayer, PiP, background audio, offline cache)                                                                           |
| Lists                | **FlashList** (Shopify) — virtualisation with recycle pool                                                                                                               |
| Sheets/Gestures      | **`@gorhom/bottom-sheet` + `react-native-gesture-handler`**                                                                                                              |
| Skia (conditional)   | **`@shopify/react-native-skia`** — add if the v3 DS Clinic map requires custom canvas                                                                                    |

### 5.1. What is reused from `@ds/design-system`

- Tailwind tokens (colors, spacing, typography) — 100%
- NativeWind preset bridges tokens into RN styles
- lucide-react-native — 1:1 import by name

### 5.2. What is not reused

- shadcn web components `<Button>`, `<Dialog>` — mobile versions in `@ds/design-system-mobile`. We aim to keep prop APIs compatible.

### 5.3. Rejected

- **Tamagui** — duplicates Tailwind, minus AI-friendliness, minus shared with web.
- **React Native Paper / Elements** — pre-built Material/iOS, constrains brand UX.

---

## 6. Webinars

Context: the webinar provider (MTS Link / Webinar.ru / BigBlueButton) is a separate brainstorm in DSO-26. Mobile must be provider-agnostic. Lesson from digest §9.1: presence-ingest is server-side, not client-polling.

### 6.1. Architectural split into 3 layers

| Layer                                                                       | Implementation                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A. A/V stream**                                                           | Depends on provider type (see 6.2)                                                         |
| **B. Chat + presence + Q&A + polls**                                        | Native RN UI over Centrifugo (ADR-0002 §7)                                                 |
| **C. Attendance ledger + NMO (Continuing Medical Education) timed-buttons** | Server-side (NestJS); mobile only generates events `viewer_heartbeat`, `tito_button_click` |

### 6.2. Stream — three patterns

| Provider type                       | Pattern                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **HLS/DASH-pull**                   | `react-native-video` native player. **Preferred path.** Pull URL signed with JWT.                      |
| **WebRTC** (interactivity required) | `react-native-webrtc` + provider JS SDK                                                                |
| **Iframe-only** (fallback)          | `react-native-webview` with CSS injection. **Worst option** — WKWebView limitations on background/PiP. |

**Hard requirement for DSO-26:** the provider must supply an HLS-egress URL. Without it — WebView fallback with provider CSS dependencies.

### 6.3. Chat via Centrifugo

Same channel `webinar:{event_id}` as the web dashboard. Chat UI — native RN: FlashList for messages, BottomSheet overlay, RHF for sending.

### 6.4. Attendance — server-driven

Mobile does NOT track time itself. It sends:

- `viewer_heartbeat` every 30s
- `tito_button_click` (title object)
- `webinar_left`

NestJS validates ≥90 min + 2 titles (digest §9.2), credits NMO.

### 6.5. IAP in webinars

PRD §15 v2 "CTA webinar for 200 Au" — internal points, IAP not needed. Real money (donation, merch) — separate flow v2 (see §7).

---

## 7. Push, biometric, IAP, deep links

| Layer                | Choice                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Push                 | `expo-notifications` (APNs/FCM) + **official `react-native-rustore-push-sdk`** from RuStore. Custom TurboModule — fallback only if official SDK is incompatible with New Architecture (validate at v1 start) |
| Push backend         | NestJS with three providers + BullMQ (ADR-0002 §6). Not OneSignal/Pushwoosh — PD zone                                                                                                                        |
| Biometric            | `expo-local-authentication` (Face ID / Touch ID / Android Biometric)                                                                                                                                         |
| Secure storage       | `expo-secure-store` (Keychain/Keystore) for session — **refresh token TTL = 14d (ADR-0001 §6)**; `react-native-mmkv` for non-secret KV                                                                       |
| IAP (Apple+Google)   | `react-native-iap` — **in v2**, not v1                                                                                                                                                                       |
| IAP RuStore          | **Official `react-native-rustore-billing-sdk`** from RuStore — **in v2**. Custom TurboModule — fallback only                                                                                                 |
| Deep links           | `expo-linking` + Expo Router (Universal Links + App Links); JSON config hosted via `apps/promo`                                                                                                              |
| Referral attribution | Native deep link state + pasteboard (iOS) + Install Referrer (Android) → NestJS attribution. NOT AppsFlyer/Adjust (PD zone)                                                                                  |

---

## 8. Offline strategy + sync

PRD §15 + digest §5: v1 SHOULD offline video; v3 MUST full offline lesson walkthrough with sync ≤5s.

### 8.1. Split into 3 data categories

| Category                                                  | Nature                          | Strategy                                 |
| --------------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| **A. Content** (video, text, tests, flashcards, glossary) | Read-only, versioned by backend | Pull-cache by version-tag                |
| **B. Progress** (current step, answers, time on video)    | Write on client, eventual sync  | Local-first SQLite + event-log           |
| **C. Ledger** (Con/Pul/Au transactions)                   | **Authoritative on server**     | Optimistic local + server reconciliation |

### 8.2. Content cache

| Component      | Choice                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Video          | `expo-file-system` / `react-native-fs` (resume, chunked)                                |
| Text/tests     | **`op-sqlite`** (JSI-based, 5-10× faster than `expo-sqlite`, FTS5)                      |
| Manifest       | NestJS `GET /lessons/{id}/manifest` → `{content_version, files: [{url, sha256, size}]}` |
| Default volume | 2 GB soft-limit with LRU-eviction (PRD §15 OQ4 — finalised via DSO-26)                  |

### 8.3. Progress sync — WatermelonDB

- **WatermelonDB** on top of SQLite. Reactive observables → UI auto-update.
- Sync API: `POST /sync/push` (client batch), `GET /sync/pull?last_pulled_at=...`.
- **Conflict resolution: field-level merge (per-column client-wins)** — WatermelonDB tracks modified fields via the `_changes` column (array of modified field names). On sync the server applies the update **only to those specific fields**, leaving other fields as server-state. This is not "LWW by client-timestamp" — it is per-column resolution.
- **Backend protocol — mandatory abort-on-stale-write:** if a push batch contains a record modified on the server after the client's `lastPulledAt` → backend **rejects the push with an error**, the client performs a pull before retrying the push. Without this check the sync pipeline silently discards server-side changes.
- Server-only fields (client cannot write): `completed_at`, `nmo_credited_at`, `confirmed_balance` — ignored on push, always read from server.
- Sync trigger: foreground, network reconnect, push "sync-needed", 5-min periodic while active.

**Why WatermelonDB, not alternatives:**

| Alternative            | Honest reason for rejection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PowerSync**          | **PowerSync Open Edition** (FSL → Apache 2.0 in 2 years) **exists** as self-hosted Docker, supports Postgres → 152-FZ compatible. Rejected for other reasons: (1) adds a separate sync-service component to infra (another process to monitor/back up); (2) smaller LLM corpus for AI agents than WatermelonDB; (3) backend integration with NestJS REST requires an adapter to the PowerSync protocol, whereas WatermelonDB sync protocol is a plain REST controller written as a normal NestJS controller. Trade-off — WatermelonDB chosen as simpler to operate. |
| RxDB                   | Mobile side less mature than WatermelonDB; fewer RN-specific docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SQLDelight+Ktor bridge | KMP-Kotlin Native layer inside RN — complexity > benefit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 8.4. Ledger reconciliation pattern

**Optimistic local credit + Server reconciliation** (NOT CRDT — wrong use-case).

1. Offline action → `pending_credit: {amount, source, client_event_id, client_timestamp}` into local event-log.
2. UI shows "+10 Con" **with pending state** (visually distinct — grey / opacity 0.6).
3. On reconnect → `POST /ledger/reconcile-pending` batch.
4. NestJS validates:
   - Lesson and task exist, doctor had the right
   - Idempotency by `client_event_id`
   - Applies authoritative entry to `ledger`, returns confirmed balance
5. Mobile receives confirmation → removes pending state.
6. Reject (fraud-check, invalidated lesson) → local rollback + toast.

**Guarantees:**

- Idempotency: UUID per event
- Authority: client never writes to `ledger`, only to `pending_credits`
- Visibility: user sees pending vs confirmed
- Recovery: 10 failures → `sync_failed` state + UI explanation

### 8.5. Backend hooks

- BullMQ processes `sync-push` batches asynchronously (ADR-0002 §6)
- Postgres table `pending_credits` separate from `ledger` (DSO-31 schema extension)
- Centrifugo `ledger.updated` → TanstackQuery `invalidateQueries` → UI refresh

---

## 9. Build, distribution, CI/CD

| Layer               | Choice                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Local dev           | Expo Dev Client (custom development build)                                                         |
| Build orchestration | EAS Build (Expo Application Services)                                                              |
| iOS CI runner       | **EAS Build cloud** (hosted macOS) — default v1; alternative GitHub Actions hosted macOS minutes   |
| Android CI runner   | Self-hosted Linux runner (same CI infra as backend, ADR-0002 §8)                                   |
| Signing             | EAS Credentials (encrypted keystore)                                                               |
| Distribution        | 3 channels: App Store Connect, Google Play Console, RuStore Console — **same AAB** in Play+RuStore |
| OTA                 | EAS Update — bugfix only (Apple Guideline 4.2 compliance)                                          |
| Versioning          | Semver + auto-increment buildNumber + Sentry release tag                                           |
| Environments        | dev / staging / production via Expo build profiles; 3 bundle IDs                                   |

### 9.1. iOS runner — revised

The build stage does not process PD (only source + assets) → the 152-FZ self-host argument does not apply to the build pipeline.

- **EAS Build cloud:** Free tier = 15 iOS builds + 15 Android builds per month (separate). Starter $19/month = $45 build credits (not "priority"). Production $99/month = 2 concurrent builds + $225 credits. Priority builds — separate feature of the Production plan. Default v1 — Starter ($19/month).
- **GitHub Actions hosted macOS:** $0.08/min × ~30 min build ≈ $2.4/build, or free if the repo has GitHub Pro/Team with macOS minutes included. Alternative.
- **Self-host Mac mini / MacStadium:** only if EAS becomes a bottleneck in v2/v3.

### 9.2. EAS Local Build secrets caveat

`eas build --local` has limitations: **does not support EAS Secrets with visibility=Secret**, does not support remote caching, does not support `--platform all`.

For a RuStore build on a self-hosted Linux runner with a local RuStore SDK: signing keystore (Android `.jks`) and RuStore tokens are passed via **CI environment variables** (GitHub Actions secrets / self-hosted CI secret store), **not** via EAS Credentials. Document the key rotation procedure in DSO-31.

### 9.3. Release flow

1. PR merge → CI: unit + e2e (Maestro on cloud Mac)
2. Tag `mobile-vX.Y.Z` → CI builds both platforms → upload to 3 stores as draft
3. Manual promote: TestFlight Internal → External Beta → Production. Same AAB in RuStore.
4. Sentry release auto-create + source maps upload

### 9.4. Escalations (DSO-31 / DSO-32)

- Apple Developer Program enrollment ($99/year, RF sanctions) — **DSO-32 legal**
- RuStore Developer account (RF legal entity via ESIA) — **DSO-32 legal**
- EAS subscription budget — **DSO-31 ops**

### 9.5. Rejected

- Fastlane — overkill, EAS covers 90%
- CodePush — Microsoft App Center deprecated 2024
- Full cloud build automation — manual promote is safer for compliance

---

## 10. Testing

| Level             | Tool                                                     | When                                               |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Unit (logic)      | Vitest or Jest                                           | v1 MUST; coverage ≥80% for `packages/`             |
| Component (RN UI) | `@testing-library/react-native` + Jest                   | v1 SHOULD                                          |
| **E2E**           | **Maestro** (YAML, queryless selectors)                  | v1 MUST for onboarding / lesson / sync             |
| Visual regression | Maestro Studio + screenshots                             | v2 SHOULD                                          |
| Performance       | Flashlight (Bam.tech) + React DevTools Profiler          | v1 MUST in CI (cold-start regression blocks merge) |
| Manual QA matrix  | Spreadsheet: iPhone 12+/Samsung A/Xiaomi mid/Huawei (v2) | v1 MUST pre-release                                |

### 10.1. Maestro vs Detox vs Appium

| Param           | Maestro          | Detox            | Appium          |
| --------------- | ---------------- | ---------------- | --------------- |
| Setup           | YAML, minutes    | JS harness, days | days            |
| AI-friendliness | 3 (YAML for LLM) | 2 (JS DSL)       | 1 (Java/Python) |
| Flakiness       | Low (auto-wait)  | Medium           | High            |
| New arch RN     | ✅               | ✅ (with lag)    | ✅              |

Maestro wins on C8 + speed-to-first-test.

### 10.2. CI integration

- Unit/component → every PR (Linux runner, ~30s)
- E2E Maestro → main branch + tag (iOS Simulator cloud Mac + Android Emulator Linux), 5-10 min
- Performance → tag + nightly. Flashlight JSON → comparison baseline

---

## 11. Observability

| What              | Tool                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash reporting   | **`@sentry/react-native` SDK** → **GlitchTip self-hosted** within RF zone (MIT-licensed, Sentry API-compatible — unified with ADR-0004 §15 web) |
| APM / Performance | GlitchTip (same instance, via the same SDK)                                                                                                     |
| Logging           | `react-native-logs` locally + GlitchTip breadcrumbs with PD-redaction via `@ds/observability`                                                   |
| Product analytics | **PostHog self-hosted** within RF zone (DSO-31 finalises)                                                                                       |
| RUM               | GlitchTip covers (cold start, FPS, transitions)                                                                                                 |
| Push delivery     | NestJS server-side metrics → Prometheus (ADR-0002)                                                                                              |

**Unified with web (ADR-0004 §15):** mobile and web use **one self-hosted GlitchTip instance** via the official Sentry SDK (`@sentry/react-native` for mobile, `@sentry/nextjs` for web). GlitchTip — MIT, on-prem free, supports the Sentry protocol → SDK switches via `dsn` config. Sentry SaaS is rejected due to PD zone. Sentry self-hosted (FSL license) — permitted, but GlitchTip provides MIT and a single observability backend per project.

### 11.1. Rejected

- Firebase Crashlytics, Firebase Analytics, Mixpanel, Amplitude, DataDog, New Relic — all SaaS/USA cloud, PD zone

### 11.2. Privacy

- All events pass through `@ds/observability` redaction middleware (`email → hash`, `phone → null`)
- User opt-out in Settings (152-FZ)
- Consent screen in onboarding — shared component with web

### 11.3. Escalation

- GlitchTip self-hosted VPS (shared with web from ADR-0004 §15) — **DSO-31 infra**

---

## 12. Monorepo placement (input for DSO-31)

```
apps/
  promo/, portal/, admin/, cms/   # web (ADR-0004)
  mobile/                          # ← Expo RN (this ADR)
packages/
  schemas/                         # Zod (shared)
  api-client/                      # openapi-typescript types (shared)
  utils/                           # pure functions (shared)
  observability/                   # GlitchTip/PostHog SDK + redaction (shared)
  hooks/                           # React >=19 hooks (shared, fallback >=18.3 on SDK 52 pin)
  design-system/                   # Tailwind tokens + lucide (shared base)
  design-system-mobile/            # NativeWind preset + react-native-reusables
  eslint-config/, tsconfig/        # shared
```

DSO-31 finalises tooling (Turborepo / Nx / pnpm workspaces), CI matrix, version strategy.

---

## 13. Open questions

| ID     | Q                                                         | Resolved in             |
| ------ | --------------------------------------------------------- | ----------------------- |
| OQ-M1  | Lottie vs Rive                                            | Product/Design v1       |
| OQ-M2  | Huawei AppGallery in scope                                | DSO-26 product spec     |
| OQ-M3  | Cache 2 GB fixed / configurable                           | DSO-26                  |
| OQ-M4  | IAP infrastructure v2 monetization                        | DSO-26                  |
| OQ-M5  | WebRTC raise-hand webinars                                | DSO-26 webinar provider |
| OQ-M6  | Apple Developer Program enrollment                        | DSO-32 legal            |
| OQ-M7  | RuStore Developer account                                 | DSO-32 legal            |
| OQ-M8  | GlitchTip self-host VPS budget (shared with web ADR-0004) | DSO-31 infra            |
| OQ-M9  | Sync-window cap (offline >14 days)                        | Product + DSO-26        |
| OQ-M10 | Retention `pending_credits`                               | DSO-26 ledger spec      |

---

## 14. Consequences

### Positive

- Single React/TS mental model on mobile+web; AI agents produce consistent code
- Shared Zod schemas + API types + utils + hooks + observability (~70-100% reuse)
- New Architecture RN removes legacy bridge issues
- All-OSS-self-host runtime stack (GlitchTip, PostHog, Centrifugo, NestJS, Postgres) — 152-FZ zone
- RN/Expo tooling — mainstream, maximum LLM corpus for AI-friendliness

### Negative

- iOS build depends on EAS cloud (external hosting) — but build does not process PD → 152-FZ-safe
- RuStore push/billing — official RN SDKs from RuStore, but require validation of New Architecture compatibility (first-time check)
- Apple Developer Program under sanctions risk — legal escalation DSO-32
- EAS Local Build does not support EAS Secrets → signing keystore passed via CI env vars (separate rotation procedure)

### Risks

- App Store rejection due to WebView webinar (if provider is iframe-only) → mitigation: hard requirement HLS-egress in DSO-26
- 60 FPS v3 DS Clinic map not achievable on low-end Android → mitigation: fallback to 30 FPS on devices below benchmark, Skia if custom canvas needed
- WatermelonDB sync conflicts on mass reconnect-burst → mitigation: BullMQ rate-limit, idempotency keys

---

## 15. What we are not choosing (negative decisions)

| What                                     | Why                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter                                  | C8 AI-friendliness (Dart < TS), no shared schemas with web                                                                                                                                     |
| Native Swift+Kotlin                      | 2 codebases × AI uplift cost                                                                                                                                                                   |
| KMP + CMP                                | C8 + immaturity of CMP-iOS (Stable 2025)                                                                                                                                                       |
| Capacitor                                | 60 FPS gameplay under WebView at risk; App Store 4.2 risk for thin-wrappers without native features (we would have added a native layer, but gameplay FPS is the primary reason for rejection) |
| Tamagui                                  | Duplicates Tailwind, minus C8, minus shared                                                                                                                                                    |
| OneSignal/Pushwoosh/RevenueCat/AppsFlyer | Vendor-managed PD outside RF zone                                                                                                                                                              |
| Firebase Crashlytics/Analytics           | PD in Google cloud                                                                                                                                                                             |
| Fastlane                                 | Overkill vs EAS                                                                                                                                                                                |
| Detox/Appium                             | C8 loses to Maestro                                                                                                                                                                            |
