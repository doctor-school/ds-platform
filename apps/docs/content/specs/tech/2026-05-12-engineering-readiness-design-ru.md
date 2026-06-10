---
title: DS Platform — engineering readiness (CI/тесты/observability/документация под AI-agent driven development)
date: 2026-05-12
status: Approved
authors: Tech Lead (с участием AI-research-агента, 2026-05-12)
---

> **EN:** [`2026-05-12-engineering-readiness-design-en.md`](./2026-05-12-engineering-readiness-design-en.md) · **RU (this)**

# Spec: engineering readiness DS-платформы под AI-agent driven development

## Контекст и проблема

DS-платформа разрабатывается **преимущественно AI-агентами в автономном режиме с оркестраторами**. Команда (2-3 человека после найма) проектирует, ревьюит ключевые точки и эксплуатирует. Платформа хранит ПДн врачей (152-ФЗ, медицинские ПДн = УЗ-3), интегрируется с фарма-партнёрами (B2B SLA), запускается на Timeweb Cloud в RF-контуре с Zone AI вне РФ.

Без явного чек-листа "обвязки" есть три риска:

1. **Compliance-blocker** на pre-pilot — без РКН-уведомления и data subject rights endpoints запуск незаконен.
2. **Регресс агентских изменений** — без сильных CI-гейтов автономная разработка ломает прод без человеческого фильтра.
3. **Накопление tech debt** — без фазового подхода либо строим всё сразу (теряем темп), либо ничего (потом не переделать).

Brainstorm-исследование подтвердило, что под AI-agent driven development стандарт 2025-2026 — расширенная обвязка с фокусом на supply chain security, OpenTelemetry GenAI, prompt-injection protection, autonomy ladder и spec-driven workflows.

## Решение

**Режим C′ — phased readiness по сигналам user-value, с baseline'ом Pre-pilot, поднятым выше обычного из-за AI-agent specifics.**

9 категорий × 3 фазы (Pre-pilot / Pilot / Scale) + явный **BLOCKER-список для Pre-pilot** (без чего не запускаем первого реального пользователя).

### Почему C′, не A или B

- **A (минимум, доращиваем)** не подходит: 152-ФЗ обязательства (data subject rights, РКН-уведомление, аудит) — это закон, не nice-to-have. Пропуск = compliance-инцидент с первого пользователя.
- **B (всё сразу)** — отвергнут не из-за стоимости (AI-агенты её обнуляют), а из-за **отсутствия адресата**: public roadmap без аудитории = шум; status page без SLA-обещаний = ложные ожидания. Фазы нарезаются по value-моментам.
- **C′** — Pre-pilot baseline выше обычного MVP (сильные CI-гейты, observability, audit log, autonomy ladder, RKN, dual-LLM), отложенные пункты — те, у которых нет адресата (public roadmap, status page, A/B-инфра).

### Phase-определения

| Фаза          | Сигнал старта                           | Цель                                                                                                         |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Pre-pilot** | сейчас → первый реальный врач в проде   | Можно безопасно запустить агентов в автономный режим и принять первого пользователя без compliance-нарушений |
| **Pilot**     | первые 1-50 врачей в закрытой группе    | Реальные пользователи активно используют, нужна полноценная observability/feedback/SLO                       |
| **Scale**     | открытый набор + B2B-фарма как партнёры | Публичный контур, SLA-обязательства, compliance-аудит                                                        |

## Pre-pilot deployment slice (DSO-63 #15, **living document**)

> **Caveat:** Living document; пересматривается по мере изменения бизнес-приоритетов / pilot-обратной связи. Не архитектурный freeze — operational prioritization для AI-агентов, чтобы не делать «всё сразу».

### In-slice (must have для pre-pilot, mandatory)

- **IdP** — Zitadel (закрыто по ADR-0001 §8, DSP-209).
- **NestJS API** (ADR-0002).
- **Postgres 17 + Drizzle** (ADR-0003).
- **Redis** (single-node + AOF, see ADR-0003 §8 responsibilities matrix; not for sessions or critical jobs).
- **Postgres outbox** для critical jobs (ADR-0003 §8).
- **Portal Next.js app** (`app.doctor.school`).
- **Admin Next.js app** (`admin.doctor.school`).
- **Docs (Fumadocs)** — внутренняя SSOT для команды (ADR-0006).
- **GlitchTip self-hosted** (этот spec §3).
- **Loki + Grafana** (minimal: API health, error rate, latency).
- **PII scrubber baseline** + telemetry classification policy (этот spec §3 + ADR-0011).
- **Backup baseline** — Timeweb primary + Beget S3 offsite + Vault keys (data-layer-design §2.4).
- **PD lifecycle endpoints** под `/me/*` (ADR-0009 §2.2).
- **Consent v1 + retention matrix** (ADR-0009).
- **Egress sanitizers + CI gates** (ADR-0011).

### Deferred до pilot (не делаем pre-pilot)

- **Payload CMS** (`cms.doctor.school`). Pre-pilot контент — через Keystatic + git workflow / напрямую в repo.
- **Promo Next.js app** отдельным application. Pre-pilot promo — часть portal или статический snippet через docs.
- **Mobile (RN + Expo)** — pre-pilot = responsive web / PWA. Mobile native — pilot trigger.
- **Centrifugo** (real-time) — если первая pilot школа не делает live webinars.
- **Tempo** (distributed tracing) — после GlitchTip + Loki.
- **Unleash** (feature flags) — изначально отложен (pre-pilot работал на конфиге через env / DB). **Обновление (2026-06): вынесен вперёд.** 003 prod-readiness выявил конкретную операторскую потребность — переключать флаги доставки (`EMAIL_DELIVERY_MODE` / `SMS_DELIVERY_MODE`) и капчи (`BOT_PROTECTION_ENABLED`) в **рантайме** через UI, а не правкой `.env` + рестартом. Развёртывание Unleash self-hosted и перенос этих env-флагов в его админ-UI теперь активный трек бэклога (infra). Конфиг через env остаётся **промежуточным bootstrap-дефолтом + fail-closed fallback'ом**, пока это не приземлится.
- **Glossary YAML sync / Keystatic editorial UI** — pre-pilot: pure markdown в repo.
- **Cross-vendor reviewer bot** — pre-pilot: один primary LLM-reviewer достаточно.
- **Cost ledger automation** — pre-pilot: manual tracking.

### Triggered-by-pilot (включается при scope первой pilot школы)

- **Webinar provider integration** (Bigbluebutton self-hosted / Контур.Толк / Mind / Trueconf) — если pilot делает live webinar.
- **NMO credit issuance flow** — если зачёт NMO нужен с первой pilot школы.

### Why this matters

Без явного slice AI-агенты при чтении ADR'ов читают «целевую архитектуру» как «всё сразу» и пытаются поднять Payload + Centrifugo + Tempo + Unleash параллельно с базовым стеком. Бесполезная работа + операционная нагрузка. Каждое ADR (0002, 0003, 0004, 0005, 0006, 0007, 0008) forward-refs сюда, фильтруя свой scope под pre-pilot. (Исключение (2026-06): **Unleash вынесен вперёд** по операторской потребности, зафиксированной в «Deferred to pilot» выше — Payload / Centrifugo / Tempo остаются отложенными.)

## 9 категорий × 3 фазы

### 1. Build & Deploy

**Pre-pilot:**

- GitHub Actions CI: `lint → types → unit → integration → contract → security-scan`, обязательное green на PR
- Preview environment на каждый PR (эфемерная, живёт пока PR открыт): Coolify/Dokploy/Argo-based на отдельном `preview-vps` (sizing + cost — ADR-0012 §Decision/§Cost envelope; pool-size triggers — ADR-0012 OQ-T4).
- TLS-автоматизация: Caddy или Traefik с Let's Encrypt, авто-renewal без ручного вмешательства агентов
- Schema migration tooling: Alembic (Python) / Flyway (если другой стек); запрет ручного SQL на prod
- Expand-contract migration policy: linter блокирует `DROP COLUMN` в одной миграции с релизом
- Feature flags: Unleash self-hosted (выбран как дефолт; альтернатива — GrowthBook self-hosted, если потребуется built-in A/B)
- Rollback procedure: одна команда, проверенная на staging до prod-релиза
- Container image signing: cosign + SLSA Level 2 provenance
- SBOM генерация: Syft на каждом build

**Pilot:**

- Внутренние зеркала pip/npm registry на Timeweb (страховка от блокировок upstream)
- Blue-green или canary деплой на prod (1 VPS → full rollout с 15-мин observation)
- Auto-rollback по триггеру (error-rate, latency-spike)

**Scale:**

- Multi-region deployment readiness (если фарма-партнёры потребуют)
- Progressive delivery (Argo Rollouts / Flagger) с автоматическим promote/abort

### 2. Testing & Environments

**Pre-pilot:**

- Четыре среды: `local → preview (per-PR) → staging → prod`
- Пирамида тестов: unit / integration (testcontainers) / contract (Pact или OpenAPI-schema validation) / E2E (Playwright, 1-3 critical paths) / smoke
- Visual regression: Playwright snapshots или Lost Pixel
- Security scan: Trivy на образах, Snyk/Dependabot/Renovate на зависимостях, OWASP-ZAP на staging
- Synthetic test data via factories (mimesis для русских имён/диагнозов)
- **Isolated agent sandbox** — отдельный namespace (Docker-сеть или k8s namespace) для агентских экспериментов, не пересекается с dev
- **Private eval-suite** — корпус из 20-50 закрытых PR с known-good diff; обязательный regression-run при смене модели/промпта оркестратора
- Release gate: два human-checkpoint'а — на merge в main и на prod-deploy

**Pilot:**

- Анонимизированный prod-snapshot на staging (с обрезанными ПДн), еженедельный refresh
- Расширенный E2E (10-20 сценариев)
- Load testing (k6) — еженедельно на staging
- **Prompt-injection red-team tests** как обязательный шаг pipeline (Snyk-Claude, Opsera, Promptfoo)
- 5-10 пилотных врачей-тестеров на staging под NDA перед prod-релизом фич

**Scale:**

- Chaos engineering: квартальные game days (зависший агент, network partition, exhausted LLM budget) с blameless postmortem
- Penetration testing (внешний аудит)

### 3. Observability + Telemetry classification & PII scrubbing policy (DSO-63 #12)

> **Pre-pilot mandatory:** telemetry classification & PII scrubbing policy — авторитативная для всех observability tools. См. также ADR-0011 (Egress control plane) — telemetry-каналы наследуют общую egress policy.

**Pre-pilot:**

- Structured logging → Loki (Grafana observability stack)
- Метрики: Prometheus + Grafana, RED-метрики на API endpoints
- Error tracking: **GlitchTip self-hosted (Sentry-API-compatible)** — финально зафиксировано в ADR-0004 §15 и ADR-0005 §10. Sentry SaaS отвергнут (ПДн out of РФ, 152-ФЗ violation).
- **OpenTelemetry GenAI Semantic Conventions v1.37** для всех LLM-вызовов агентов (трейсы, span'ы с model/tokens/cost).
- Единый tracing pipeline (только GlitchTip + Loki pre-pilot; Tempo/Jaeger — pilot).
- **Tamper-evident audit log** — отдельная storage (append-only PG-таблица с hash-chain — ADR-0003 §6; ADR-0009 §2.4 для erasure tombstoning compatibility).
- Базовые dashboards: API health, error rate, latency p50/p95/p99, БД connections.

#### 3.bis Telemetry classification & PII scrubbing policy

**Data classification:**

| Class                             | Описание                                                                 | Где допустимо в телеметрии       |
| --------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Public                            | Кодовые константы, route paths без params                                | везде                            |
| Internal                          | Build metadata, deployment versions, request IDs (без user-binding)      | везде                            |
| PD                                | `subject_id` (UUID), `email_hash`, `phone_hash`, role labels             | only via hashed/redacted forms   |
| Special-category PD (медицинские) | Diagnosis, medical history, specialty (когда identifying), chart content | **никогда** в логи/traces/errors |
| Secrets                           | API keys, DB passwords, tokens, KEK/DEK                                  | **никогда нигде**                |

**SDK scrubbers (mandatory pre-pilot):**

- **GlitchTip `beforeSend` hook** — strip request bodies, headers (Authorization, Cookie), URL query params матчащие PII regexes. Конфиг в `apps/api/src/observability/glitchtip.ts` + frontend equivalent в `packages/observability-frontend/`.
- **OTel processor** — trace attribute allowlist. Запрет `http.request.body`, `db.statement` (если SQL может содержать PD), `user.email`, `user.phone`. Whitelist подход.
- **Loki promtail processors** — drop / replace patterns в log lines перед ingestion. Регулярки на email, phone, RU-passport-like sequences.
- **Mobile crash reports** — без attachment / screenshot support; only stack trace + sanitized metadata.

**Log schema:**

- Все application logs — structured JSON.
- Allowlist полей в `packages/observability/log-schema.ts`. Freeform `message` field только для technical descriptions, без PD.

**PII scanner в CI (mandatory pre-pilot):**

- `tools/pii-scanner-precommit` (pre-commit + CI gate).
- Regex для emails (`@`), phones (RU 7-9-?\\d{10}), РФ passport (4-4-2 digit groups), credit cards (Luhn).
- AST-check на patterns: `console.log(*user*)`, `logger.info({ ...user })`, `Sentry.captureException(err, { extra: { user } })` → CI fail.

**Red-team тесты (pre-pilot):**

- Каждый CI run прогоняет `tests/red-team/pii-leakage.test.ts`:
- Register test subject with unique PD marker string (`zzzPII-{uuid}@test.local`).
- Drive subject через все API endpoints + error scenarios.
- Проверка: marker не появляется в GlitchTip output / Loki / Tempo / metrics endpoint / Prometheus labels / cost ledger.
- Failure → CI fail, hard gate.

**Access controls:**

- GlitchTip / Grafana / Loki — internal-only access (VPN или IdP-protected `obs.doctor.school`).
- Per-user access logged in audit_ledger.
- AI-агенты НЕ имеют access к observability tools (нет need-to-know; данные могут содержать post-scrub residue).

**Cross-reference:**

- ADR-0011 §2.2 каналы #1 (AI calls), #3 (CI logs) — этот policy реализует sanitizer requirements.
- ADR-0009 §2.4 — audit_ledger tombstoning compatibility.

**Pilot:**

- **Формальный SLO + Error Budget Policy** документ с автозаморозкой релизов при истощении бюджета
- **DORA метрики dashboard** — deployment frequency, lead time, MTTR, change failure rate. Видеть влияние агентов на delivery.
- Behavioral analytics: PostHog self-hosted
- Alerting: AlertManager → on-call (Mattermost/Telegram + email)
- Capacity dashboard: CPU/RAM/disk/connections, ранние сигналы апгрейда

**Scale:**

- Distributed tracing на 100% trafic (vs sampling)
- Public-facing internal metrics (latency, uptime) для B2B-партнёров

### 4. Data resilience

> **Backup topology — single source of truth: `data-layer-design §2.4`** (canonical после DSO-63 #9 — Timeweb primary + Beget S3 offsite + Vault keys на отдельной VM + quarterly restore drill). Этот раздел только перечисляет dependencies + secrets-management требования.

**Pre-pilot:**

- **Postgres backup:** см. data-layer-design §2.4 (multi-provider offsite, separation of custody, crypto-shred compatibility per ADR-0009 §2.5).
- **S3 (user uploads):** bucket versioning включён; cross-bucket replication на Beget S3 weekly (idem schema, separate provider).
- **Restore drill** — ежеквартально, документировано в operational runbook (DSO-задача под DSO-10).
- **PITR drill** — отдельная процедура (восстановление в произвольную точку), не только full-restore. В том же runbook.
- **Secrets management:** Vault на отдельной VM (см. ADR-0009 §5 — также хранит per-subject DEK для PD encryption); Phase 0 acceptable — Vault-light (sealed master-key в systemd credential), Phase 1+ → full Vault.
- pgroll или эквивалент для автоматизации expand-contract schema changes.

**Pilot:**

- DR runbook: явные RTO (4 часа) и RPO (1 час) с тестированием
- Read replica PG для аналитики (отделить OLTP от reporting)
- Secrets rotation procedure (документированная, ежеквартальная)

**Scale:**

- Multi-region replication
- Dynamic short-lived credentials через Vault transit (вместо статичных `.env`)

### 5. Security & Compliance

> **Изменено 2026-05-18 (DSO-63 #7, #8, #5+#6):** 187-ФЗ снят (DS Platform не КИИ); УЗ-3 зафиксирован как архитектурное допущение; PD lifecycle + consent — в **ADR-0009**; Edge & comms providers registry — ниже в §5.bis.

**Архитектурное допущение УЗ-3:** Архитектура DS Platform спроектирована под УЗ-3 для ИСПДн со специальной категорией PD (медицинские). Формальная классификация ИСПДн по ФСТЭК-21 + РКН-уведомление об обработке PD — параллельный legal track (DSO-X2), **hard launch gate перед pre-pilot** (не блокирует разработку). 187-ФЗ N/A — DS Platform не является объектом КИИ (DSO-63 #7 — Doctor.School давно действующий частный B2B-бизнес, не гос. учреждение / оператор связи / банк).

**Pre-pilot (несколько BLOCKER'ов — см. отдельный раздел):**

- WAF / rate limiting: **Qrator vs EdgeCenter** — выбор делается в §5.bis Edge & comms providers registry (архитектурный sub-вопрос: in-line proxy + anti-DDoS vs CDN-with-WAF). НЕ Cloudflare — заблокирован в РФ.
- Email deliverability: SPF, DKIM, DMARC для `doctor.school` (DNS-записи в Beget); SMTP через выбранный provider из §5.bis.
- **152-ФЗ data subject rights**: API endpoints `/me/data-export` + `/me/erasure-request` — **closed by ADR-0009 §2.2** (Pre-pilot mandatory).
- **Privacy policy, договор-оферта, cookie consent UI** — статически на сайте + JS-баннер; consent capture через `/me/consent/accept` (ADR-0009 §2.1, per-purpose versioning).
- **Уведомление РКН** об обработке ПДн — DSO-X2 (legal track), launch gate.
- TLS-headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options). CSP profile-per-zone — ADR-0001 §7.
- **Dual-LLM pattern** для UGC — pre-pilot BLOCKER. Закрывается **ADR-0010 (dual-LLM mandatory pattern)** + design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`**. Quarantined LLM → symbolic references → privileged LLM. ADR-0011 channel #4 (reviewer agent prompts) — связанные controls.
- **Endpoint authorization matrix как CI-gate** — pre-pilot BLOCKER. Закрывается **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`** (CI gate `tools/lint-endpoint-authz` — fail на missing metadata).
- **Worker readiness (BullMQ queue contract)** — pre-pilot BLOCKER. Закрывается **`2026-05-18-ds-platform-bullmq-queue-contract-design`** (имена очередей, retry/DLQ/idempotency, critical vs non-critical, queue→worker).
- **Egress sanitizers + CI gates** — закрывается ADR-0011 + telemetry policy выше в §3.bis.
- Отдельные API-токены: агент vs пользователь vs CI, least privilege.
- Запрет write-доступа агента в prod-DB и main-branch напрямую; ВСЁ через PR.
- Dependency security scan на каждом PR (часть категории 1).

**Pilot:**

- **Аттестат соответствия УЗ-3 152-ФЗ** для медицинских ПДн (формальная процедура, требует аудитора) — формальное подтверждение архитектурного допущения.
- **Prompt injection scan** на тело PR/issue (Snyk-Claude или Opsera embedding-similarity).
- Secrets rotation — автоматизировать критичные (DB-пароли, API-ключи третьих сторон).
- WAF-правила настроены и тюнятся под реальный трафик.
- Bug bounty (внутренний, для команды) или партнёрство с security-исследователями.

**Scale:**

- Dynamic short-lived credentials (Vault transit).
- External penetration test (квартально).
- SOC 2 / ISO 27001 (если фарма-партнёры потребуют).
- Compliance-документация: Политика обработки ПДн (consent_versions per ADR-0009), договоры с подпроцессорами (Timeweb, Beget, SMS-гейтвей, email provider — registry в §5.bis).

#### 5.bis Edge & comms providers registry (DSO-63 #8)

Reg list внешних processor'ов с DPA-status, fallback chain, и категорией. Обновляется по мере выбора provider'а. Каждая запись — input для Privacy Notice + РКН-уведомления (DSO-X2).

| Category                        | Primary                                                                      | Fallback                                                                          | DPA-status                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DNS**                         | Beget                                                                        | —                                                                                 | n/a (нет PD на DNS-слое)                  | Уже выбран. См. [[reference_beget_dns]].                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **CAPTCHA**                     | Yandex SmartCaptcha                                                          | —                                                                                 | DPA подписан                              | Уже выбран. RF-доступная.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **CDN**                         | Timeweb CDN                                                                  | EdgeCenter CDN                                                                    | DPA с Timeweb (есть) / EdgeCenter (нужен) | Default Timeweb — стек уже там.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **WAF**                         | **Qrator vs EdgeCenter — TBD** (sub-decision pre-pilot)                      | ModSecurity / Coraza на nginx-уровне (fallback на старте если managed недоступен) | Подписывается с выбранным                 | Архитектурный sub-вопрос: Qrator — managed inline-proxy + anti-DDoS; EdgeCenter — CDN с WAF. Влияет на где живёт edge rate-limiting (на WAF vs в backend).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **SMS**                         | **SMS-Aero** (smsaero.ru Gate API v2)                                        | SMSC.ru / SMS.ru (взаимозаменяемый RF fallback)                                   | Подписывается per provider                | **Решено** (заменяет прежний "implementation moment"; Plane DSO-26/57/58 — только cross-tracker ссылки). Gate API v2 — HTTP Basic (`email:api_key`), `POST https://gate.smsaero.ru/v2/sms/send`, params `number`/`text`/`sign` (default sign `SMS Aero`); env `SMSAERO_EMAIL`/`SMSAERO_API_KEY`/`SMSAERO_SIGN`. RF, 152-ФЗ-compliant. Circuit-breaker / failover — в identity-auth-rbac-design §5. **Dev-stand:** локальный стенд не ходит в SMS-Aero — generic HTTP SMS provider Zitadel постит в локальный `sms-sink` (SMS-аналог Mailpit; `infra/dev-stand`), так что SMS-OTP (003 EARS-7) тестируется вживую без реальной отправки. |
| **Email transactional**         | TBD (Unisender / SendPulse / Mailganer / Selectel mail / SMTP через Timeweb) | TBD                                                                               | Подписывается per provider                | Выбор — implementation moment. Bounce handling в backend. SPF/DKIM/DMARC на Beget DNS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Email bulk / marketing**      | Unisender (RF, привычка существующего Doctor.School)                         | TBD                                                                               | Подписывается                             | Marketing-only; transactional ≠ marketing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Push notifications (web)**    | self-hosted Web Push (VAPID)                                                 | n/a                                                                               | —                                         | Pre-pilot deferred (mobile = PWA).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Push notifications (mobile)** | TBD — pilot trigger                                                          | TBD                                                                               | —                                         | Включается при mobile native (см. ADR-0005 mobile phasing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Webinar / video**             | TBD — pilot trigger (если live webinars нужны)                               | —                                                                                 | Подписывается                             | Bigbluebutton self-hosted / Контур.Толк / Mind / Trueconf shortlist. См. DSO-X6 conditional placeholder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Launch gate перед pre-pilot:**

- Все required категории (DNS, CAPTCHA, CDN, WAF, SMS primary, Email transactional primary) — provider выбран + DPA подписан + в Privacy Notice + в РКН-уведомлении (DSO-X2).
- Optional категории (push, webinar) — открыты, не блокируют onboarding первого доктора.

### 6. User feedback & roadmap

**Pre-pilot:**

- Внутренний канал для ручного фидбека (Mattermost-канал #feedback)
- Internal changelog (для команды и пилотных тестеров)

**Pilot:**

- In-app feedback widget: Marker.io self-hosted или самописный (skip-кнопка + текстовое поле + автоскриншот)
- Behavioral analytics: PostHog self-hosted (включается в этой фазе, не Pre-pilot — нет смысла без пользователей)
- 1st-line incident response runbook
- Onboarding success metrics dashboard (% завершивших onboarding, drop-off по шагам)

**Scale:**

- Public roadmap: Canny self-hosted или GitHub Discussions с template'ами
- Public status page: Instatus, Gatus self-hosted, или самописный (минимум — `status.doctor.school` со SLA-метриками за 30 дней)
- Public changelog
- A/B-инфра (через Unleash + аналитический attribution в PostHog)
- SLA-договорённости с фарма-партнёрами

### 7. Agent operations

**Pre-pilot:**

- **Autonomy ladder document** — явный реестр: Phase 1 = read-only / Phase 2 = PR без merge / Phase 3 = merge с обязательным human review / Phase 4 = end-to-end автономия. Кто и по каким критериям апрувит переходы.
- **Global agent kill switch** — один config-флаг (или env-var, или Unleash feature flag), останавливающий ВСЕХ агентов разом. Применяется в случае аномалии.
- **Agent action provenance** — каждый агентский коммит подписан + содержит в metadata: `agent-id`, `model-version`, `prompt-hash`, `spec-id` (ссылка на ADR/spec). Достаточно git trailers + commit signing.
- **LLM-cost dashboard** — расход токенов по проектам/агентам/задачам (Portkey, Bifrost или самописный middleware)
- **Per-project / per-agent LLM budget cap** с inline-rejection (отказ запроса при превышении)
- **Prompt caching enforcement** — system prompts и spec-документы кэшируются (Anthropic prompt caching API), мониторинг hit-rate
- **"AI PRs face stricter checks" policy** — отдельные требования к AI-PR: выше coverage, обязательный security scan, blocking human review даже для small changes
- **Guardrails** — список запрещённых операций (`DROP DATABASE`, force-push в main, `rm -rf` на prod-инстансе, удаление бэкапов) — enforced через wrapper-скрипты + IAM-политики
- **Human-in-the-loop checkpoints** — обязательный approval на: (1) merge в main, (2) prod-deploy

**Pilot:**

- **SDD-loop первого класса** — spec → ADR → plan → tasks как обязательная цепочка; CI-валидация что код ссылается на spec-id
- **Отдельный "agent CI" pipeline** — eval-suite на private corpus + prompt-injection regression + cost regression (предупреждение если новый промпт стоит на 30%+ больше предыдущего)
- Agent action audit log — отдельно от обычного audit log, с retention 12+ месяцев

**Scale:**

- **Adaptive autonomy** — автоматическое повышение Phase per task-type по метрикам success rate / MTTR агента; снижение при регрессе
- Multi-agent coordination patterns (если будет несколько оркестраторов работающих параллельно)

### 8. Spec & ADR governance

**Pre-pilot:**

- ADR-формат (Markdown, шаблон в репо): context / decision / consequences / alternatives
- Каталог ADR в репо (`apps/docs/content/adr/`) + индекс
- Spec-формат (`apps/docs/content/specs/`)
- Обязательность: новая фича = spec до кода, изменение архитектуры = ADR
- Spec/ADR — read context для агентов через MCP или прямое чтение репо

**Pilot:**

- CI-валидация: код ссылается на spec-id в PR-описании или commit trailer; PR без ссылки = warning
- ADR-graph — визуализация зависимостей между ADR (manual или auto через парсер)
- Spec deprecation lifecycle — как помечать устаревший spec

**Scale:**

- Executable specs (Gherkin / contract tests, generированные из spec)
- Машино-валидируемые spec (JSON Schema / OpenAPI fragments в spec-документе)
- Автоматическая ревалидация spec'а при изменении кода (если spec ссылается на функции — проверять что они существуют)

### 9. Documentation

**Pre-pilot:**

- **README discipline** per репозиторий/сервис: что это, как запустить, как развернуть, owner, ссылки на spec/ADR
- **API-доки**: автогенерация OpenAPI из кода (FastAPI/NestJS/etc.) → **Scalar** (default) или Redoc → публикация на `api.doctor.school/docs` (auth-gated на Pre-pilot/Pilot)
- ADR-каталог: source в репо (`docs/adr/`), индекс mirror в Outline
- Архитектурные диаграммы как код (Mermaid/PlantUML/Structurizr) в репо, рендер в Outline
- **Runbook'и** в репо (source) + mirror в Outline для on-call: incident response, restore-from-backup, secret rotation, DSR handling
- Технический changelog: автогенерация из conventional commits, публикация (Scalar-страница или `developer.doctor.school`)
- Базовая структура Outline: `Technical / User / Process / ADRs`
- **Doc freshness checks** в CI: битые ссылки, ссылки на несуществующие файлы (агенты читают доки как контекст — устаревшие = галлюцинации)

**Pilot:**

- User-facing гайды в Outline:
- Гайд для врача (onboarding, прохождение курса, получение NMO-сертификата)
- Гайд для админа CMS (контент-менеджер DS)
- FAQ по сегментам пользователей
- In-app onboarding flows (link out на Outline-гайды)
- Process docs: "How to contribute" (включая AI-agent), release runbook, incident response

**Scale:**

- Партнёрские доки (фарма-кампании, аналитика, лиды) в Outline
- Видео-туториалы (хостинг через Vimeo Pro / самописный плеер на S3+CDN)
- Public API-доки на `developer.doctor.school` (если выходим в public API)
- Multilang (en-US если потребуется для международных партнёров)

## BLOCKERS для Pre-pilot

Без этих пунктов **не запускаем первого реального врача в прод**:

### Compliance (юридические)

1. **Уведомление РКН** об обработке ПДн подано и принято (DSO-X2 legal track).
2. **Классификация ИСПДн по ФСТЭК-21** — формальный акт с УЗ-3 (DSO-X2). 187-ФЗ N/A (не КИИ).
3. **Privacy policy + договор-оферта + per-purpose consent** опубликованы; capture через `/me/consent/accept` per-version (ADR-0009 §2.1).
4. **152-ФЗ data subject rights endpoints**: data export, data deletion — рабочие (ADR-0009 §2.2 — Pre-pilot mandatory).
5. **Retention matrix** opublished в `packages/db/schema/pd/retention.ts` + CI-validated (ADR-0009 §2.6).
6. **Cookie consent UI** на всех публичных страницах.
7. **Edge & comms providers — все required категории** (DNS, CAPTCHA, CDN, WAF, SMS primary, Email primary) — provider выбран + DPA подписан (см. §5.bis).

### Security

8. **Dual-LLM pattern** для всего UGC (issues, support, загружаемые файлы) — reference impl в ai-stack-design §6 (DSO-X5).
9. **Egress sanitizers + CI gates** (PII scanner, audit-egress-channels) — ADR-0011 §2.4.
10. **Отдельные API-токены** агент/пользователь/CI с least privilege; запрет write агента в prod-DB и main-branch.
11. **TLS + security headers** настроены (HSTS, CSP profile-per-zone per ADR-0001 A1.2).
12. **Email deliverability** (SPF/DKIM/DMARC) настроен для doctor.school.
13. **Host-only `__Host-` cookie per app + OIDC silent re-auth** (ADR-0001 §6) — нет shared cross-subdomain cookies.

### Operational

14. **Backup topology canonical** — Timeweb primary + Beget S3 offsite + Vault keys на отдельной VM (data-layer-design §2.4).
15. **Restore drill** документирован в operational runbook (DSO-10) + один раз протестирован end-to-end перед pre-pilot.
16. **Per-subject crypto-shred** работает (ADR-0009 §5) — erasure compatible с 30-day 152-ФЗ SLA.
17. **Redis ops baseline** — AOF + daily RDB backup + per-namespace eviction policy + alerting (ADR-0003 §8).
18. **Global agent kill switch** работает.
19. **Autonomy ladder document** написан, текущий уровень агентов зафиксирован.

### Observability

20. **Tamper-evident audit log** работает, охватывает: изменения данных врачей, агентские действия, admin-операции (ADR-0003 §6 + ADR-0009 §2.4 tombstoning).
21. **Telemetry classification & PII scrubbing policy** — реализована (этот spec §3.bis). PII scanner CI gate + red-team тесты работают.
22. **Error tracking** (GlitchTip self-hosted) подключён ко всем сервисам, с beforeSend scrubber.
23. **OpenTelemetry GenAI tracing** включён для всех LLM-вызовов + attribute allowlist + per-call audit (ADR-0011 channel #1).

## Tooling decisions (default стек)

Зафиксированные конкретные инструменты (можно менять через ADR с обоснованием):

| Слой               | Default                                                                      | Альтернатива                                   |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| CI/CD              | GitHub Actions                                                               | Forgejo Actions (self-hosted) если потребуется |
| Preview env        | Coolify self-hosted на Timeweb                                               | Dokploy, Argo Rollouts                         |
| Container signing  | cosign + Syft (SBOM)                                                         | —                                              |
| Logs               | Loki                                                                         | self-hosted ELK если потребуется               |
| Metrics            | Prometheus + Grafana                                                         | VictoriaMetrics                                |
| Error tracking     | GlitchTip self-hosted (fixed by ADR-0004 §15 / ADR-0005 §10)                 | — (Sentry SaaS отвергнут: ПДн out of РФ)       |
| Tracing            | Tempo (Grafana stack)                                                        | Jaeger                                         |
| Audit log storage  | append-only PG-таблица с hash-chain                                          | S3 WORM bucket                                 |
| Secrets            | Vault self-hosted                                                            | Doppler, Bitwarden self-hosted                 |
| Feature flags      | Unleash self-hosted                                                          | GrowthBook self-hosted                         |
| Migration tool     | Alembic (PG) + pgroll для expand-contract                                    | Flyway                                         |
| E2E                | Playwright                                                                   | —                                              |
| Load testing       | k6                                                                           | Artillery                                      |
| WAF/DDoS           | Qrator или EdgeCenter                                                        | ModSecurity/Coraza на nginx (старт)            |
| CDN                | Timeweb CDN (default), Selectel CDN, EdgeCenter                              | —                                              |
| DNS                | **Beget** (текущий регистратор и DNS-провайдер для всех доменов DS Platform) | —                                              |
| Email SMTP         | Resend (через свой домен) или Selectel mail                                  | —                                              |
| API docs renderer  | **Scalar**                                                                   | Redoc                                          |
| Prose docs / wiki  | Outline self-hosted                                                          | —                                              |
| User analytics     | PostHog self-hosted (на Pilot)                                               | —                                              |
| Public status page | Gatus self-hosted (на Scale)                                                 | Instatus                                       |
| Public roadmap     | Canny self-hosted (на Scale)                                                 | GitHub Discussions                             |
| LLM cost gateway   | Portkey или Bifrost                                                          | самописный middleware                          |

## Что этот spec НЕ покрывает

- **Конкретные T-shirt sizes VPS** под каждый компонент — это в plan'е #2 (Plane prod-миграция) и в дальнейших plan'ах под DS-платформу
- **Юридическая модель 152-ФЗ-уведомления и УЗ-3 аттестации** — отдельная задача Product Lead + юристов, не инфра
- **Архитектура самой DS-платформы** (модули, сервисы, данные) — в платформенном PRD и отдельных spec'ах
- **Zone AI-архитектура** — отдельный spec при появлении первого AI-воркера в продакшне
- **Конкретный design агент-оркестратора** — отдельный spec

## Источник

- Brainstorm-сессия 2026-05-12 с Tech Lead
- AI-research-агент (general-purpose), исследование стандартов 2025-2026
- Tenancy-решение (2026-05-12)
- Infra-research (2026-05-07)
- Платформенный PRD
