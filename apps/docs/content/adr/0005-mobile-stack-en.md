> **EN (this)** · **RU:** [`0005-mobile-stack-ru.md`](./0005-mobile-stack-ru.md)

# ADR-0005 — Mobile Stack for DS Platform

**Date:** 2026-05-14
**Status:** Accepted
**Related to:** Plane DSO-29 (`8ecbe6ff-9c29-489c-9cae-d704b1ee7211`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0005-mobile-stack-design-en.md`
**Inherits:** ADR-0001 (Identity/Auth: IdP shortlist Authentik/Zitadel — TBD per §8 spike), ADR-0002 (Backend: NestJS+REST+Centrifugo+BullMQ+Timeweb storage), ADR-0003 (Postgres17+Drizzle, Cerbos RBAC §5, Redis), ADR-0004 (Frontend: Next.js 15 App Router + 4 apps + Refine + Payload v3)

---

## Context

DS Platform is a medical education platform. The doctor mobile app is the primary gameplay front-end (PRD §15): lesson walkthroughs, clinical tasks, avatar upgrades, Con/Pul/Au tracking, video series, webinars, runs (zabegi / забеги), offline learning.

Hard requirements (digest §8.5, PRD §15 AC):

- iOS 15+ / Android 10+
- Cold start ≤3s→2s, crash-free ≥99→99.7%, 60 FPS gameplay
- Push (APNs+FCM+RuStore), biometric, IAP option v2
- Fully offline lessons v3 MUST + sync ≤5s
- Distribution: **App Store + Google Play + RuStore** (per user decision on brainstorm)

Constraints inherited:

- Federal Law 152-FZ (personal data (PD) within RF (Russian Federation) perimeter)
- AI-first development (mainstream stack, large LLM corpus — mandatory)
- Shared schemas/types with web — desirable, intrinsic to the choice

[[feedback_tech_stack_criteria_no_team_skill]] — prohibits "team knows X", "prototypes on X", "RF hiring-pool" as pro-arguments. Prototype `doctor-school-mobile-app-proto/` (Next.js PWA) is excluded from influencing this decision.

---

## Decision

> **Mobile phasing (DSO-63 mini-C, 2026-05-18):** Pre-pilot mobile = **responsive web / PWA** (via the portal Next.js app, ADR-0004). Native mobile (RN + Expo, §1 below) — **pilot trigger** (push notifications + offline capabilities required by the first pilot school, or RuStore / App Store distribution). v3 — full offline / gameplay. The choice in this ADR (RN + Expo as the long-term tech) **remains valid** — phasing applies to the timing of the build, not the tech choice. See engineering-readiness §"Pre-pilot deployment slice" for the full in-slice / deferred / triggered list.

### 1. Core: **React Native 0.78+ + Expo SDK 53+ + New Architecture + React 19 + TypeScript strict + Hermes**

Selected via weighted scoring across 13 objective criteria (see design spec §2.2). RN places first with 75 points, Flutter — 71, Native — 67, KMP — 66, Capacitor — 62. The gap over Flutter is 4 points — above noise level.

RN wins on:

- **C13 — TypeScript monorepo SSOT reuse** (Zod schemas + api-client types + utils + hooks + observability shared with web from ADR-0004) — the main intrinsic differentiator
- C8 AI-friendliness (TS/React — the largest LLM corpus among UI stacks)
- C10 Ecosystem health (Meta backing, dogfooded in Facebook/Instagram)

The gap with Flutter on C1 (60 FPS) is closed by Reanimated 3 (UI thread) + Skia (`@shopify/react-native-skia`). Native (C9=0, C13=0) loses on two codebases under AI-first dev.

**Versions:** RN 0.78 released 2025-02-19, ships React 19 → unified with web (Next.js 15 + React 19, ADR-0004). At the start of v1 dev (2026 H2) the current Expo SDK will be 53+/54+, React 19 unified out of the box. An ESLint guard on React-19-only APIs in shared packages is **not needed**.

Legacy architecture is banned: Fabric + TurboModules + JSI are mandatory.

### 2. Distribution: **App Store + Google Play + RuStore**

The same AAB is used for Play and RuStore. PWA-only has been removed from consideration. Apple Developer Program enrollment + RuStore Developer account — legal escalation in DSO-32.

### 3. Navigation/State/Data

- Navigation: **Expo Router v4** (file-based, mental model matches Next.js App Router from ADR-0004)
- Server state: **Tanstack Query v5** (same as web)
- Client/UI state: **Zustand** vanilla
- Forms: **RHF + zodResolver**, schemas from `@ds/schemas` (imported literally)
- API client: types from **openapi-typescript** via `@ds/api-client` (ADR-0002 §5)
- Realtime: **Centrifugo JS client** (ADR-0002 §7)

**React 19 unified:** RN 0.78+ (Expo SDK 53+) ships React 19, same as web (Next.js 15). Shared `packages/hooks` pins `peerDependencies: react>=19.0`. No ESLint guards on React-19 APIs in shared packages — both platforms run React 19. Fallback to peer `>=18.3` — only if mobile is forced to pin to Expo SDK 52 / RN 0.76 (not planned).

### 4. UI library

- **NativeWind v4** (Tailwind preset for RN) — same config from `@ds/design-system`
- **`react-native-reusables`** (shadcn-style owned-code for RN) — parallel to shadcn/ui from ADR-0004
- **`lucide-react-native`** (same icon set)
- **Reanimated 3** (UI thread) + **Moti** for animations
- **`lottie-react-native` + `rive-react-native`** both installed, choice per-feature
- **`react-native-video`** (HLS, PiP, offline cache), **FlashList** (virtualized), **`@gorhom/bottom-sheet`** + **`react-native-gesture-handler`**
- **`@shopify/react-native-skia`** — conditional, if the v3 DS Clinic map requires custom canvas

### 5. Webinars — three-layer architecture (provider-agnostic)

| Layer                                                            | Implementation                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A. A/V stream                                                    | `react-native-video` for HLS-pull (preferred); `react-native-webrtc` for interactivity; `react-native-webview` fallback |
| B. Chat + presence + Q&A + polls                                 | Native RN UI over Centrifugo, same channel as web                                                                       |
| C. Attendance + NMO (Continuing Medical Education) timed-buttons | Server-driven; mobile only sends events (`viewer_heartbeat`, `tito_button_click`)                                       |

**Hard requirement for DSO-26 brainstorm (webinar provider):** the provider must supply an HLS-egress URL. Without it — WebView fallback with CSS dependencies.

Lesson from digest §9.1 is locked in: presence-ingest is server-side, not client-polling.

### 6. Push, biometric, IAP, deep links

- Push: `expo-notifications` (APNs+FCM) + **official `react-native-rustore-push-sdk`** from RuStore (`rustore-dev/react-native-rustore-push-sdk`). Custom TurboModule — fallback only if the official SDK is incompatible with New Architecture (validate first-time at v1 start). Backend — own NestJS with three providers + BullMQ (ADR-0002). NOT OneSignal/Pushwoosh (PD zone).
- Biometric: `expo-local-authentication` (Face ID/Touch ID/Android Biometric)
- Secure storage: `expo-secure-store` for session — **refresh token TTL = 14d (ADR-0001 §6)**; `react-native-mmkv` for non-secret KV
- IAP: `react-native-iap` (Apple+Google) + **official `react-native-rustore-billing-sdk`** — **deferred to v2**, infrastructure is not built in v1
- Deep links: `expo-linking` + Expo Router (Universal Links + App Links); JSON config hosted via `apps/promo`
- Referral attribution: native deep link + pasteboard (iOS) + Install Referrer (Android) → NestJS. NOT AppsFlyer/Adjust (PD zone)

### 7. Offline + sync — three-tier architecture

Separate strategies for three data categories:

| Category                                                          | Strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Content (video, text, tests) — read-only, server-versioned     | Pull-cache by version-tag via manifest. `expo-file-system` for video; **`op-sqlite`** (JSI, 5-10× faster than `expo-sqlite`, FTS5) for text                                                                                                                                                                                                                                                                                                                  |
| B. Progress (current step, answers) — write client, eventual sync | **WatermelonDB** + custom NestJS sync-adapter (`POST /sync/push`, `GET /sync/pull?last_pulled_at=...`). **Field-level merge (per-column client-wins)** via `_changes` tracking — this is a native WatermelonDB pattern, not "LWW by timestamp". Backend **must abort push** if a record was modified after `lastPulledAt` → client performs a pull and retries. Server-only fields (ignored on push): `completed_at`, `nmo_credited_at`, `confirmed_balance` |
| C. Ledger (Con/Pul/Au) — authoritative server                     | **Optimistic local + server reconciliation pattern**. Client writes to `pending_credits` locally with a UUID; UI shows pending state; on reconnect → `POST /ledger/reconcile-pending` batch → NestJS validate (idempotency, fraud, authority) → confirm/reject                                                                                                                                                                                               |

Default cache: 2 GB soft-limit LRU (PRD §15 OQ4 finalised in DSO-26).

Sync trigger: foreground, network reconnect, push "sync-needed", 5-min periodic. Latency target ≤5s after reconnect (digest §5).

**Alternatives rejected:**

- **PowerSync Open Edition** (FSL → Apache 2.0 in 2 years) — self-hosted Docker, supports Postgres → 152-FZ-compatible. Not chosen for operational reasons: adds a separate sync-service to infra; smaller LLM corpus than WatermelonDB; backend integration requires an adapter to the PowerSync protocol, whereas WatermelonDB sync is a plain REST controller in NestJS.
- RxDB — mobile side less mature, fewer RN docs.
- SQLDelight+Ktor — KMP-Kotlin-Native bridge inside RN, complexity > benefit.

CRDT is not used — server is always authoritative for currency (Con/Pul/Au), CRDT machinery is unnecessary.

### 8. Build, distribution, CI/CD

- Local dev: **Expo Dev Client** (custom development build, not Expo Go — RuStore SDK+WatermelonDB+react-native-iap require it)
- Build orchestration: **EAS Build**
- **iOS CI runner: EAS Build cloud (hosted macOS)** — default v1. Free tier = 15 iOS + 15 Android builds/month; Starter $19/month = $45 build credits; Production $99/month = 2 concurrent + $225 credits. The 152-FZ self-host argument does not apply to the build stage (build does not process PD). Alternative — GitHub Actions hosted macOS (~$2.4/build at $0.08/min). Self-host Mac mini / MacStadium — v2/v3 only if EAS becomes a bottleneck.
- Android CI runner: self-hosted Linux on the same CI infrastructure as the backend (ADR-0002 §8)
- Signing: EAS Credentials (encrypted keystore)
- Distribution: 3 channels (App Store Connect, Google Play Console, RuStore Console). Same AAB in Play+RuStore.
- OTA: **EAS Update** — bugfix only (Apple Guideline 4.2 compliance). Native changes — store release only.
- Versioning: semver + auto-increment buildNumber + Sentry release tag
- Environments: dev/staging/production, three separate bundle IDs

**Gotcha:** RuStore publishing requires an AAB build with a native build that links the RuStore SDK in `android/app/build.gradle`. EAS Build with `--local` mode or a GitHub Actions Linux runner. **EAS Local Build does not support EAS Secrets** → signing keystore and RuStore tokens are passed via CI environment variables (GitHub Actions secrets / self-hosted CI secret store).

### 9. Testing

- Unit/component: **Vitest/Jest + `@testing-library/react-native`**, coverage ≥80% for `packages/`
- **E2E: Maestro** (YAML, queryless selectors) — beats Detox/Appium on C8 (AI-friendliness) and speed-to-first-test
- Visual regression: Maestro Studio screenshots (v2 SHOULD)
- Performance: **Flashlight** (Bam.tech) + React DevTools Profiler. Cold-start regression >200ms blocks merge.
- Manual QA matrix: iPhone 12+, Samsung A-series, Xiaomi mid, Huawei (v2)

### 10. Observability

- Crash + APM + RUM: **`@sentry/react-native` SDK → GlitchTip self-hosted** (MIT, Sentry API-compatible). **Unified with ADR-0004 §15** — one GlitchTip instance per project, web uses `@sentry/nextjs`, mobile uses `@sentry/react-native`.
- Product analytics: **PostHog self-hosted** within RF zone (DSO-31 finalises)
- Logging: `react-native-logs` locally + GlitchTip breadcrumbs with PD-redaction via `@ds/observability`
- Push delivery: NestJS server-side metrics → Prometheus (ADR-0002)

Rejected: Sentry SaaS (PD outside RF); Firebase Crashlytics/Analytics, Mixpanel, Amplitude, DataDog, New Relic, AppsFlyer/Adjust, OneSignal/Pushwoosh — all outside PD zone.

### 11. Monorepo placement (input for DSO-31)

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

DSO-31 finalises tooling (Turborepo/Nx/pnpm workspaces), CI matrix, version strategy.

---

## Consequences

### Positive

- Single React/TS mental model on mobile+web — consistent AI codegen
- Shared Zod + API types + utils + hooks + observability (70-100% reuse from web)
- React 19 unified on mobile+web (RN 0.78 / Expo SDK 53+, Next.js 15) — no transition period
- New Architecture RN removes legacy bridge issues
- All-OSS-self-host runtime (GlitchTip, PostHog, Centrifugo, NestJS, Postgres) — 152-FZ zone
- Mainstream RN/Expo — maximum LLM corpus for AI-friendliness
- Same AAB in Google Play and RuStore — no duplicate Android builds
- Provider-agnostic webinars — independent from the DSO-26 webinar choice
- Unified observability with web (one GlitchTip instance)

### Negative

- iOS build depends on EAS cloud (external hosting) — but build does not process PD → 152-FZ-safe
- RuStore push/billing — official RN SDKs exist but require validation of New Architecture compatibility (first-time check)
- Apple Developer Program under sanctions risk (legal DSO-32)
- EAS Local Build does not support EAS Secrets → separate signing keystore management procedure via CI env vars

### Risks

- App Store rejection if webinar provider only provides iframe → mitigation: hard requirement HLS-egress in DSO-26
- 60 FPS v3 DS Clinic map not achievable on low-end Android → mitigation: 30 FPS fallback + Skia if needed
- WatermelonDB sync conflicts on mass reconnect-burst → mitigation: BullMQ rate-limit + idempotency UUIDs

---

## Alternatives considered (rejected)

| Alternative                              | Score | Reason                                                                                                                                                                                     |
| ---------------------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flutter                                  |  71   | C13 SSOT (no shared Zod/utils/hooks with web) + C8 AI-corpus (Dart) smaller                                                                                                                |
| Native Swift+Kotlin                      |  67   | C9=0 (2 codebases) + C13=0 (no SSOT with web) × AI uplift                                                                                                                                  |
| KMP+CMP                                  |  66   | CMP-iOS Stable only 2025, minimal LLM corpus, C13=1                                                                                                                                        |
| Capacitor + React                        |  62   | 60 FPS gameplay under WebView at risk (C1) — main reason; App Store 4.2 risk for thin-wrappers                                                                                             |
| PWA-only                                 |  n/a  | Removed by user's distribution requirement (App Store+Play+RuStore)                                                                                                                        |
| Tamagui                                  |  n/a  | Duplicates Tailwind, minus C8, minus shared                                                                                                                                                |
| Sentry SaaS                              |  n/a  | PD outside RF. GlitchTip self-hosted covers it (Sentry API-compatible)                                                                                                                     |
| OneSignal/Pushwoosh/RevenueCat/AppsFlyer |  n/a  | Vendor PD outside RF                                                                                                                                                                       |
| Firebase Crashlytics/Analytics           |  n/a  | PD in Google cloud                                                                                                                                                                         |
| PowerSync                                |  n/a  | Open Edition self-hosted available (FSL→Apache 2.0); rejected for operational reasons — separate sync-service, smaller LLM corpus, more complex backend integration than WatermelonDB REST |
| Fastlane                                 |  n/a  | Overkill vs EAS                                                                                                                                                                            |
| Detox/Appium                             |  n/a  | C8 loses to Maestro                                                                                                                                                                        |
| Custom RuStore push/billing TurboModule  |  n/a  | Official RN SDKs `react-native-rustore-push-sdk` + `react-native-rustore-billing-sdk` exist; custom — fallback only                                                                        |

---

## Open questions (deferred)

| ID     | Q                                                         | Resolved in             |
| ------ | --------------------------------------------------------- | ----------------------- |
| OQ-M1  | Lottie vs Rive                                            | Product/Design v1       |
| OQ-M2  | Huawei AppGallery in scope                                | DSO-26                  |
| OQ-M3  | Cache 2 GB fixed/configurable                             | DSO-26                  |
| OQ-M4  | IAP infrastructure v2                                     | DSO-26 monetization     |
| OQ-M5  | WebRTC raise-hand                                         | DSO-26 webinar provider |
| OQ-M6  | Apple Developer Program enrollment                        | DSO-32 legal            |
| OQ-M7  | RuStore Developer account                                 | DSO-32 legal            |
| OQ-M8  | GlitchTip self-host VPS budget (shared with web ADR-0004) | DSO-31 infra            |
| OQ-M9  | Sync-window cap (offline >14 days)                        | Product + DSO-26        |
| OQ-M10 | Retention `pending_credits`                               | DSO-26 ledger spec      |

---

## Related ADRs / Delegated

**Inherited from:**

- ADR-0001 — IdP shortlist (Authentik/Zitadel TBD per §8 spike), OIDC/OAuth2; Cerbos RBAC lives in ADR-0003 §5; refresh token TTL=14d (mobile per §6)
- ADR-0002 — NestJS REST + Centrifugo + BullMQ + openapi-typescript codegen
- ADR-0003 — Postgres17 + Drizzle + Redis (`pending_credits` table — schema extension via DSO-31)
- ADR-0004 — Tailwind tokens + lucide icons + RHF+Zod + GlitchTip (mobile uses the same GlitchTip instance)

**Delegated to other tasks:**

- **DSO-26 (Product spec):** webinar provider HLS-requirement; cache cap; IAP/monetization scope v2; sync-window cap; `pending_credits` retention; ledger reconciliation specification
- **DSO-31 (Engineering readiness):** monorepo tooling (Turborepo/Nx/pnpm); mobile CI matrix; GlitchTip self-host infra; keystore rotation procedure; `pending_credits` Postgres schema
- **DSO-32 (Legal):** Apple Developer Program enrollment ($99/year, RF sanctions risk); RuStore Developer account; user consent screens 152-FZ

**Affects (downstream blockers):**

- DSO-26 — hard requirement: webinar provider must supply HLS-egress
- DSO-31 — input for monorepo placement (apps/mobile + design-system-mobile)
- v1 implementation (after full stack selection) — starts with this ADR as mobile-core
