---
title: "DS Platform — Identity / Auth / RBAC design [RU]"
description: "1. RBAC = гибрид — IdP знает 9 product-ролей (PRD §13) как groups + временная legacy_admin группа на migration window + MFA-policy per group;..."
lang: ru
---

> **EN:** [`0001-identity-provider-shortlist-design-en.md`](./0001-identity-provider-shortlist-design-en.md) · **RU (this)**

# DS Platform — Identity / Auth / RBAC design

**Дата:** 2026-05-12 (v2 — после независимого арх-ревью, плотная ревизия security baseline + миграции)
**Notion title:** [BBM · DS] 2026-05-12 — DS Platform: Identity / Auth / RBAC design
**Notion page ID:** —
**Мастер:** репозиторий → `apps/docs/content/adr/0001-identity-provider-shortlist-design-ru.md`
**Автор:** Tech Lead Сидоров
**Связан с:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24
**Входы:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.1/§1.1/§9.3, `outputs/2026-05-12-ds-platform-inventory.md`, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`
**Выход:** `apps/docs/content/adr/0001-identity-provider-shortlist-ru.md` + ввод для DSO-26..31

---

## 0. TL;DR

1. **RBAC = гибрид** — IdP знает 9 product-ролей (PRD §13) как groups + временная `legacy_admin` группа на migration window + MFA-policy per group; fine-grained и object-level permissions + audit log живут в backend. Целевая admin/operational-ролевая модель — продуктовая задача (не 1:1 миграция 7 ролей Directual).
2. **UI — headless для credentials, near-headless для social.** Все credential-формы (login/register/reset/MFA/magic-link) — на `doctor.school` через IdP headless API, UI IdP не показывается. Social login — классический OAuth redirect через наш subdomain `auth.doctor.school`, ~1 сек видимый hop.
3. **Identifiers — dual + UUID PK.** Phone и email оба unique и оба login-методы; UUID — единственный FK-ключ. Phone-first UX на mobile/doctor-flow, email-first на admin/expert-flow.
4. **Auth-методы v1:** email+password, email+magic-link, phone+SMS-OTP, biometric unlock (mobile, локальный), MFA TOTP — обязательно для `expert / clinic_admin / investor / platform_admin`; MFA SMS как acceptable trade-off для `moderator / support` на v1 (downgrade плановый, см. §5).
5. **OAuth — phased rollout.** v1: без social. v2: VK ID + Yandex ID + Telegram Login. v3: Apple Sign-In если iOS App Store. Max / Google — по требованию. **Account linking требует verified-email с обеих сторон** (защита от pre-auth account takeover).
6. **Tokens:** OAuth 2.0 BCP (RFC 9700). Access JWT 15min + opaque refresh 30d (web) / 14d (mobile), rotating single-use. PKCE для public clients. Sender-constrained refresh для mobile (DPoP / device-id binding). Server-side session store (Redis). Force-logout через DELETE session. IdP introspection — только для high-stakes endpoints (admin/payments/AU withdrawal/role-change), не на горячем пути.
7. **Security baseline (§5.5):** rate limiting per-user/IP/ASN, enumeration protection (idempotent responses на login/reset), SMS toll-fraud защита (global budget circuit-breaker + IP/ASN limits), RF-доступная CAPTCHA (Yandex SmartCaptcha), account-lockout policy, refresh token theft detection. **Cookie default — `__Host-` prefix per app**; cross-app SSO continuity через OIDC silent re-auth (ADR-0001 Amendment A2, supersedes A1.1).
8. **IdP shortlist:** **Authentik** и **Zitadel** — равноценные кандидаты, финальный выбор — спайк на 2 рабочих дня в Phase 0. Альтернативы (Keycloak, Logto, FusionAuth, Ory Kratos, Authelia) отвергнуты явно в ADR.
9. **Миграция Directual:** Phase 0 discovery (hash format + реальный count + consent re-acquisition план) → bulk import (hash-compatible → as-is; иначе magic-link reset) → **90-дневное** soft-migration окно (не 30) с реалистичным целевым reactivation rate 50–70% (не 95%) → sunset Directual auth.
10. **Deferred gaps** (§10.3) — явный реестр того, что не закрывается в DSO-25 и должно быть в backlog: consent management, right-to-erasure, ФЗ-187/ФСТЭК-17, anomaly detection, HIBP credential check, OWASP ASVS pen-test gates.

---

## 1. Scope и non-goals

### В scope DSO-25

- IdP-выбор архитектурно (shortlist), интерфейсная модель, формат токенов, набор auth-методов, RBAC layering, миграционная стратегия из Directual, **security baseline для auth-слоя**.

### Не в scope DSO-25 (deferred)

- **Финальный выбор Authentik vs Zitadel** — спайк в Phase 0 implementation.
- Конкретный SMS-провайдер (SMSC.ru / SMS.ru / др.) — DSO-26 (backend integrations) с failover-2-провайдера requirement из digest §2.
- Policy engine для backend RBAC (Cerbos / OPA / OpenFGA / SQL-based) — DSO-26.
- Где живёт session store (внутри IdP или общий backend Redis) — Phase 0 implementation (см. §7.4).
- ЕГРЮЛ API верификация клиник (v3) — DSO-26.
- Бизнес-flow «загрузка диплома + ручная модерация» — продуктовая задача.
- Consent management подсистема (`consent_history`) — DSO-26 (см. §10.3).
- Right-to-erasure flow — DSO-26 (см. §10.3).
- ФЗ-187 (КИИ) и ФСТЭК-17/21 классы защиты — параллельный compliance-track (см. §10.3).
- Anomaly detection / impossible travel — v3 feature.
- HIBP credential check на регистрации — v2 enhancement.
- Pen-test gates по OWASP ASVS / MASVS уровням — DSO-26 + перед v2 release.

---

## 2. RBAC architecture (decision: hybrid)

### 2.1. Layering

```
┌────────────────────────────────────────────────────────────┐
│ IdP (Authentik / Zitadel)                                  │
│ — Хранит: users, credentials, groups (coarse roles),       │
│   MFA-policy per group, sessions, auth audit log.          │
│ — Выдаёт: OIDC tokens с claims {sub, roles[], mfa, sid}.   │
└─────────────────────┬──────────────────────────────────────┘
                      │ JWT (fast path) + introspection (high-stakes)
                      ▼
┌────────────────────────────────────────────────────────────┐
│ Backend                                                    │
│ — Хранит: user_roles (mapping), object-level связи         │
│   (course_authorships, clinic_memberships, expert_links),  │
│   fine-grained permissions, domain audit log               │
│   (append-only ledger-style).                              │
│ — Решает: «может ли actor X сделать action A на resource R»│
│   через policy engine (TBD в DSO-26).                      │
└────────────────────────────────────────────────────────────┘
```

### 2.2. Группы в IdP — минимизация в v1

Reviewer-замечание принято: 9 групп с самого начала — избыток для phase 0. **v1 включает только active groups; остальные добавляются инкрементально по мере появления функционала.**

| Group            | Активна с                           | Доступ                                               | MFA required                       |
| ---------------- | ----------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `guest`          | v1                                  | публичный контент                                    | ❌                                 |
| `doctor_guest`   | v1                                  | mini-app QR, ограниченный mobile preview             | ❌                                 |
| `doctor`         | v1                                  | full mobile, web-кабинет врача                       | ❌                                 |
| `legacy_admin`   | v1 (migration)                      | временный fallback для legacy admin-users, read-only | ✅ (см. §8.5 bootstrap)            |
| `platform_admin` | v1                                  | admin/CMS                                            | ✅ TOTP                            |
| `expert`         | v2 (когда кабинет эксперта запущен) | кабинет эксперта, AI tools                           | ✅ TOTP                            |
| `moderator`      | v2                                  | модерация контента                                   | ✅ SMS (v1-acceptable; TOTP в v2+) |
| `support`        | v2                                  | техподдержка через Plane                             | ✅ SMS (v1-acceptable; TOTP в v2+) |
| `investor`       | v2                                  | кабинет инвестора                                    | ✅ TOTP                            |
| `clinic_admin`   | v3                                  | кабинет клиники                                      | ✅ TOTP                            |

**MFA-трейд-офф:** TOTP-enrollment для всех 6 ролей в один cutover — operational перегрузка для команды 1-2 человек. Для ролей с низкой плотностью (`moderator`, `support` — 1–2 человека) на v1 acceptable SMS-MFA (несмотря на NIST SP 800-63B deprecation для high-assurance); upgrade на TOTP по мере роста команды. Для ролей с доступом к payments/AU/identity-операциям (`expert`, `platform_admin`, `investor`, `clinic_admin`) — TOTP обязателен сразу.

Admin/operational роли DS Platform — **продуктовая задача параллельно**, не 1:1 миграция из Directual.

**manager-иерархия** (`manager1_user` из Directual) — backend table `manager_hierarchy` (structural data, не permission-модель).

**Multi-group membership** — нативный паттерн в обоих кандидатах IdP. Доктор-эксперт-в-клинике = три группы одновременно.

### 2.3. Что НЕ в IdP (живёт в backend)

- **Object-level relations:** `course_authorships`, `clinic_memberships`, `expert_course_links`, `manager_hierarchy`.
- **Fine-grained permissions:** `course.create`, `lesson.publish`, `user.verify`, `withdraw_au_for_user`, `transfer_event_manager`, и т.д. — computed на основе (role, resource, context) policy engine'ом, НЕ хранятся как IdP claims.
- **Domain audit log:** append-only `audit_events` table, 3-летняя ретенция, неудаляемая даже `platform_admin` (PRD §31). См. §7.3 для списка обязательных событий.

### 2.4. Принципы

- JWT-claims минимальные: `sub`, `roles[]`, `mfa: bool`, `sid`, `iat`, `exp`, `jti`. `roles[]` — coarse-grained ярлыки (4–10 строк), не permission-листы; объём токена остаётся <1KB. Никаких `permissions[]`, `resources[]`, attribute-листов.
- Один canonical actor ID — UUID из IdP `sub`. Все backend FK ссылаются на этот UUID.
- Smena IdP не должна ломать backend RBAC — изоляция за тонким SSO-слоем.

### 2.5. Endpoint authorization matrix (DSO-63 #A, обязательный артефакт)

> **Forward-ref:** детальный контракт matrix-row, формат `apps/api/docs/endpoint-authz-matrix.md`, CI-gate `tools/lint-endpoint-authz`, sample pre-pilot endpoints — см. **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`**. Ниже — нормативный stub, полная спецификация в указанном design spec.

**Требование:** каждый REST/RPC endpoint backend'а имеет classification metadata — required role(s), Cerbos vs fast-path policy check, audit requirement, тест-покрытие. Источник правды — TS-аннотации NestJS controllers + сводная таблица в `apps/api/docs/endpoint-authz-matrix.md`. CI gate `tools/lint-endpoint-authz` валидирует, что каждый decorated endpoint имеет полную metadata; missing metadata → CI fail.

**Структура matrix-row:**

| Поле             | Описание                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `endpoint`       | HTTP method + path, или RPC name                                                              |
| `required_roles` | minimum role(s) для доступа (`guest`, `doctor`, `expert`, `platform_admin`, …)                |
| `auth_check`     | `fast-path` (JWT only) или `cerbos` (full policy eval)                                        |
| `object_attrs`   | object-level checks (например, `course.author_id == actor.id` для `course.update`)            |
| `audit`          | `none` / `low-stakes` / `high-stakes` — определяет, требуется ли запись в `auth_audit_events` |
| `test_coverage`  | ссылка на e2e-test или unit-test покрытие                                                     |

**Pre-pilot scope:** matrix создаётся **до первого endpoint'а**; AI-агенты при генерации новых endpoints обязаны заполнять row. Mismatch (endpoint без metadata) — блокирующий CI gate. DSO-задача (DSO-X4) на initial setup + tooling.

**Why this matters:** Two-tier validation (§7.2) только работает если backend корректно классифицирует high-stakes endpoints. Ошибка классификации = security gap. Без enforced matrix эта классификация делается ad-hoc, что в AI-driven dev — major risk.

---

## 3. Identifiers и data model

### 3.1. User identity table (backend mirror)

```
users:
  id              UUID PK                  -- canonical, = IdP sub
  phone           TEXT UNIQUE NULL          -- E.164
  email           TEXT UNIQUE NULL
  email_verified  TIMESTAMP NULL
  phone_verified  TIMESTAMP NULL
  display_name    TEXT
  primary_locale  TEXT DEFAULT 'ru'
  status          ENUM('active', 'pending_migration', 'dormant', 'suspended', 'deleted')
  source          ENUM('new', 'migrated_directual', 'oauth_provisioned')
  created_at      TIMESTAMP
  CONSTRAINT email_or_phone_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
```

Backend `users` — **mirror** на основе IdP user-events. **Этот хэндшейк — критическая точка дизайна, ему нужна explicit consistency strategy:**

### 3.2. IdP → backend user sync (outbox + reconcile)

- **Primary channel — webhook** (IdP → backend `POST /internal/idp/events`). События: `user.created`, `user.updated`, `user.deleted`, `user.group_changed`. Передача — HMAC-signed payload.
- **Idempotency** — webhook-receiver хранит `processed_events` table с `(event_id, processed_at)`; дубликаты no-op.
- **Outbox в IdP** — если IdP не поддерживает встроенный outbox (Authentik/Zitadel — нет), kompensiruем через retry на стороне webhook-receiver: 5xx ответ = IdP повторяет с exponential backoff (Authentik webhook policy / Zitadel actions).
- **Reconciliation cron** — раз в час backend опрашивает IdP admin API (`GET /api/v3/core/users/` с `?last_modified__gte=`), сверяет с `users` mirror, чинит drift. Любой drift событие пишется в `audit_events` как `idp_sync_drift_detected`.
- **На потерю webhook** — reconciliation cron закрывает gap в течение ≤1 часа. Это acceptable trade-off для медплатформы (≠ финтех, где требуется <1 минута).

### 3.3. UX-приоритеты identifier'а

| Surface                                                     | Primary registration                   | Secondary login                    |
| ----------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Mobile app (#15) — doctor                                   | Phone + SMS-OTP, без пароля            | email + password, email magic-link |
| Mini-app QR (#16, прототип)                                 | Phone-first (как сделано)              | —                                  |
| Web кабинет врача (#17)                                     | Поле «Телефон или email» с auto-detect | пароль / SMS-OTP / magic-link      |
| Web эксперт / clinic_admin / investor / admin (#14, #18–20) | Email + password обязателен            | + 2FA                              |
| Legacy migration users                                      | Email (как в Directual)                | + диалог «добавьте телефон»        |

---

## 4. UI model — terminology clarification

### 4.1. Принципы

- **Headless для credentials:** все формы login/register/reset/MFA/magic-link — на нашем домене (`doctor.school`, `app.doctor.school`, mobile native), шлют JSON в IdP headless API, получают next-step JSON. UI IdP пользователь не видит.
- **Near-headless для social:** social-login — это **классический OAuth Authorization Code Flow с PKCE** (RFC 7636), который по спецификации требует browser-редирект на провайдера. Видимый hop через наш subdomain `auth.doctor.school` под нашим брендом — ~1 сек. Не «headless» в строгом смысле, но и не «сторонний IdP UI».

### 4.2. По провайдерам

| IdP           | Headless mechanism                                                          |
| ------------- | --------------------------------------------------------------------------- |
| **Authentik** | `POST /api/v3/flows/executor/<flow-slug>/` — пошагово через `flow executor` |
| **Zitadel**   | gRPC + REST sessions API, native headless-first                             |

Оба покрывают login / register / password reset / magic-link / SMS-OTP / MFA prompts OOB.

### 4.3. Social login flow

```
[doctor.school login form]
   │ click "Войти через VK"
   ▼
[auth.doctor.school/source/oauth/login/vk/?code_challenge=...]   ← PKCE
   │ редирект на VK
   ▼
[vk.com/oauth/authorize]
   │ user consent, callback с code
   ▼
[auth.doctor.school/source/oauth/callback/vk/]
   │ IdP проверяет PKCE verifier, создаёт/линкует user (см. §6.2 guards), выдаёт auth code
   ▼
[doctor.school/auth/callback]                  ← наш фронт
   │ обменивает code на сессию
   ▼
[doctor.school/app]                            ← залогинен
```

### 4.4. Native mobile

- Первый логин: phone+OTP / email через headless API; токены сохраняются в iOS Keychain / Android Keystore.
- Subsequent: biometric unlock снимает локальную блокировку, **не auth-flow** — токены остаются те же, IdP не дёргается.
- Token refresh: refresh-token rotation при каждом подъёме приложения с истёкшим access; refresh sender-constrained (см. §7.2).
- Social login на mobile: ASWebAuthenticationSession (iOS) / Custom Tabs (Android) с тем же `auth.doctor.school` редирект-flow, PKCE обязателен.

---

## 5. Auth-методы (v1)

| Метод              | Surface                                                                 | Реализация                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email + password   | Все web-фронты                                                          | bcrypt/argon2 (IdP-managed), policy: ≥12 символов / mixed case / digit; **enumeration protection** на login (idempotent response, см. §5.5)                                                                   |
| Email + magic-link | Все surface для returning users                                         | TTL 15 мин, single-use, **invalidate prior pending tokens на новый request** (защита от token-flood), rate-limit 3 запроса / hour / email, привязан к user-agent при first-click (защита от перехвата ссылки) |
| Phone + SMS-OTP    | Mobile, web (опция), mini-app                                           | 6-digit code, TTL 5 мин, **rate-limit многослойный** (см. §5.5: 3/hour/phone + 10/hour/IP + global circuit-breaker)                                                                                           |
| Biometric unlock   | Mobile only                                                             | Локальный unlock сессии (TouchID/FaceID/Android biometric), не auth-flow                                                                                                                                      |
| MFA TOTP           | `expert` / `clinic_admin` / `investor` / `platform_admin` (digest §8.1) | Обязательно для перечисленных групп; устанавливается при первом входе                                                                                                                                         |
| MFA SMS            | `moderator` / `support` v1 (downgrade), backup-канал TOTP для остальных | v1 trade-off для low-cardinality ролей с low ops-capacity; upgrade на TOTP в v2                                                                                                                               |

WebAuthn / Passkeys — **out of scope v1**, добавляется в v2 как дополнительный метод (оба кандидата IdP это умеют).

### 5.5. Security baseline для auth-слоя

Минимальный набор защит для production-launch. Реализация — частично IdP, частично reverse-proxy / API gateway / backend (точное разделение — DSO-26).

| Защита                             | Где               | Конкретика                                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting — per-user           | IdP / API gateway | Login: 5 попыток / 15 мин / `(email \| phone)`, далее лок на 30 мин или CAPTCHA                                                                                                                                                                            |
| Rate limiting — per-IP             | API gateway       | Login + register: 20 попыток / 15 мин / IP; SMS-OTP запрос: 10 / hour / IP                                                                                                                                                                                 |
| Rate limiting — per-ASN            | API gateway       | Anti-distributed: 100 попыток / hour / ASN на login + register endpoints (отсекает coordinated bot networks)                                                                                                                                               |
| SMS toll-fraud защита              | API gateway + IdP | (1) per-phone 3/hour, (2) per-IP 10/hour, (3) per-ASN 100/hour, (4) **global daily budget circuit-breaker** (≤2000 SMS/день на старте; превышение → alert + pause SMS endpoint)                                                                            |
| Account lockout policy             | IdP               | После 10 failed login в 30 мин — soft-lock 30 мин + email notification владельцу; admin-роли — длиннее lock + manual unlock через support                                                                                                                  |
| Refresh token theft detection      | IdP               | Re-use уже использованного refresh-token (RFC 6819) → **invalidate ВСЕЙ цепочки refresh tokens этой сессии** + alert + force re-auth                                                                                                                       |
| Email/phone enumeration protection | IdP + backend     | Login + reset + register endpoints возвращают **идентичный response** независимо от существования user'а («если такой email есть, мы отправили письмо»). Timing-разница ≤50ms                                                                              |
| CAPTCHA после N попыток            | API gateway       | **Yandex SmartCaptcha** (RF-доступная) — hCaptcha/reCAPTCHA в РФ deprecated. Триггер: 3+ failed login / IP за 5 мин                                                                                                                                        |
| Compromised credentials check      | IdP / backend     | **Deferred to v2:** HIBP Pwned Passwords k-anonymity API на регистрации + смене пароля                                                                                                                                                                     |
| CSRF protection                    | Backend           | CSRF-tokens на mutating endpoints; SameSite=Lax cookie + `__Host-` prefix per app (нет shared cross-subdomain cookies)                                                                                                                                     |
| Cookie security                    | Backend           | `Secure; HttpOnly; SameSite=Lax; __Host-` prefix per app; **никаких токенов в localStorage**. Cross-app continuity — OIDC silent re-auth (ADR-0001 Amendment A2, supersedes A1.1). Полный session security profile — ADR-0001 §6 (single source of truth). |
| Session fixation protection        | IdP               | Regenerate session-id при login и при MFA-elevation                                                                                                                                                                                                        |
| PII в логах                        | Backend           | Email/phone маскируются в логах (`a***@example.com`, `+7***1234`); полные значения только в шифрованном audit log с RF-resident KMS                                                                                                                        |

---

## 6. OAuth social — phased rollout

| Этап            | Providers                        | Условие активации                                                                                           |
| --------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| v1 (MVP launch) | —                                | Без social                                                                                                  |
| v2              | VK ID, Yandex ID, Telegram Login | После того как воронка работает и регистрация новых врачей через соцсети даёт реальный uplift конверсии     |
| v3 mobile       | + Apple Sign-In                  | Только если выходим на iOS App Store с social login (App Store policy форсит SIWA при наличии любых social) |
| По требованию   | Max ID, Google                   | После product-validation use case                                                                           |

> **Обоснование откладывания social в v1:** v1 user-base ≤200 пользователей из существующей Doctor.School базы (digest §0). Все они уже имеют email-аккаунты в Directual → magic-link/password покрывает 100%. Reviewer аргументирует «VK даст +15-25% конверсии на врачебной аудитории» — это валидно для **growth-фазы (v2)**, когда подключается mass-funnel acquisition. На v1 social = чистый cost без benefit. Если product-команда даст evidence-обоснование (A/B на лендингах прототипа `doctor-school-mobile-app-proto/` показал uplift) — VK ID/Telegram могут быть форсированы в v1; решение остаётся переоткрываемым.

### 6.1. Реализация (одинаково для Authentik и Zitadel)

- VK ID, Yandex ID, Max — generic OAuth2 source через config + **PKCE обязателен** (RFC 7636).
- Telegram Login — НЕ OAuth2, требует custom flow stage / action, валидирующий HMAC-подписанный callback от Telegram Login Widget. Решается одинаково в обоих IdP: ~50 строк custom Python (Authentik) или Go (Zitadel) + webhook.
- Apple Sign-In — Apple Developer Program registration ($99/год) + Services ID + JWT signing key. Конфиг провайдера в IdP стандартный.

### 6.2. Account linking — защита от pre-auth account takeover

**Критическая уязвимость, которую нельзя допустить:** атакующий регистрирует VK-аккаунт с email жертвы (VK не верифицирует email при регистрации) → автоматический линк → атакующий получает доступ к DS-аккаунту жертвы. Это CVSS 9.0+ pre-auth account takeover.

**Правила линкования:**

| Сценарий                                                                              | Действие                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Social-аккаунт email **не verified** провайдером                                      | Никакого автолинка. Создать новый DS-аккаунт ИЛИ предложить manual link через owned channel (см. ниже).                   |
| Social email verified провайдером **И** в DS уже есть аккаунт с тем же verified email | Автолинк разрешён.                                                                                                        |
| Social email verified, но в DS аккаунт с этим email — **unverified**                  | Никакого автолинка. Запросить email-verification у DS-аккаунта (отправить magic-link). После успешной верификации — линк. |
| Phone match (Telegram Login возвращает phone)                                         | Аналогично: оба phone должны быть verified.                                                                               |
| Coлкупmission match (verified-verified)                                               | Линк автоматический, audit-событие `account_linked_auto`.                                                                 |
| Manual link (из кабинета «Связанные аккаунты»)                                        | Пользователь уже залогинен в DS, добавляет social. Confirm через email/SMS на текущий канал перед линкованием.            |

**Дополнительно:** Audit-event `account_link_attempt_rejected` пишется при rejected-сценариях, чтобы детектить целевые атаки на конкретных пользователей.

В UI: кабинет «Связанные аккаунты» — добавить/удалить provider.

---

## 7. Sessions и tokens

OAuth 2.0 BCP (RFC 9700) reference implementation.

### 7.1. Параметры

| Параметр                           | Значение                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access token                       | JWT, RS256/ES256, TTL **15 мин**                                                                                                                                                                                                                                                                                                                             |
| Access claims                      | `sub`, `roles[]`, `mfa`, `sid`, `iat`, `exp`, `jti`                                                                                                                                                                                                                                                                                                          |
| Refresh token                      | Opaque, rotating single-use                                                                                                                                                                                                                                                                                                                                  |
| Refresh TTL (web)                  | 30d                                                                                                                                                                                                                                                                                                                                                          |
| Refresh TTL (mobile)               | **14d** (снижено с 90d по reviewer-замечанию — sender-constrained refresh без proof-of-possession при 90d даёт слишком долгое окно компрометации)                                                                                                                                                                                                            |
| Refresh sender-constraint (mobile) | Device-id binding: при выпуске refresh запоминается `device_fingerprint` (combination of installation_id, platform, model); при обмене проверяется match. Несовпадение → reject + alert. **DPoP (RFC 9449)** рассматривается для v2 как более строгая защита.                                                                                                |
| Mobile storage                     | iOS Keychain / Android Keystore                                                                                                                                                                                                                                                                                                                              |
| Web storage                        | HttpOnly + Secure + SameSite=Lax cookie с `__Host-` prefix. **Не localStorage.** **Каждое приложение (portal, admin, promo, docs, cms) держит свою host-only cookie**; cross-app continuity — через OIDC silent re-auth (см. §7.5). Полный security profile — ADR-0001 §6 + Amendment A2 (single source of truth).                                           |
| Session store                      | Redis, server-side, привязан к refresh-token                                                                                                                                                                                                                                                                                                                 |
| Force-logout                       | DELETE session record → invalidates refresh; access умирает в течение 15 мин. Для admin-аккаунтов критические endpoints дёргают introspection (см. §7.2).                                                                                                                                                                                                    |
| List active sessions               | IdP admin API                                                                                                                                                                                                                                                                                                                                                |
| MFA-elevated session               | Отдельный claim `acr=mfa-fresh`, TTL 30 мин (снижено с 1ч); admin-действия требуют свежий MFA. Forward-ref: формальный step-up authentication contract (когда требуется re-MFA, какие endpoints, TTL) — **ADR-0001 Amendment A4 (step-up authentication)** + matrix-поле `step_up_required` в `2026-05-18-ds-platform-endpoint-authorization-matrix-design`. |
| PKCE для public clients            | **Обязателен** для mobile + SPA web-фронтов (RFC 7636)                                                                                                                                                                                                                                                                                                       |
| JWKS caching                       | Backend кэширует JWKS с TTL 10 мин; при rotation — **graceful overlap window** 24ч (старый и новый ключ оба валидны)                                                                                                                                                                                                                                         |

### 7.2. JWT vs introspection — explicit trade-off

Reviewer-замечание: «JWT 15min + introspection — внутренне противоречиво». Принимаем и обосновываем явно:

- **Fast path (≥99% запросов):** JWT signature validation локально через JWKS cache. ~0ms latency, stateless. Применяется для всего read-flow doctor/expert + большинства write-операций.
- **High-stakes path (<1% запросов):** IdP `/introspect` (RFC 7662) дёргается для:
- Payment endpoints (создание заказа, withdraw AU, refund).
- Role-change / permission-grant операций.
- Admin / `platform_admin` mutations.
- User-PII export / right-to-erasure операции.
- Любые операции, которые в случае компрометированного access-token в 15-мин окне могут нанести material damage.
- **Локальный кеш introspection** — 60 секунд per `jti`. Снижает latency повторных проверок без significant security delta (компрометированный токен живёт ≤60с в кеше после force-logout).
- **Trade-off:** stateless для масштаба + statefulness там где это материально. Не «противоречие», а explicit two-tier model.

### 7.3. Audit log auth-событий (mandatory)

3-летняя ретенция (PRD §31). Список событий, которые **обязаны** писаться в `auth_audit_events`:

| Событие                         | Поля                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `login_success`                 | user_id, method (password/magic-link/SMS-OTP/social/biometric), ip, user_agent, geo, ts |
| `login_failure`                 | identifier_hash, reason (wrong_password, no_user, lock, captcha_failed), ip, ts         |
| `mfa_enrolled`                  | user_id, method (totp/sms), ts                                                          |
| `mfa_used`                      | user_id, method, ts                                                                     |
| `mfa_failure`                   | user_id, method, reason, ts                                                             |
| `mfa_reset`                     | user_id, by_admin (uuid or null), ts                                                    |
| `password_changed`              | user_id, by_self/by_admin, ts                                                           |
| `password_reset_requested`      | user_id (or null), identifier_hash, ip, ts                                              |
| `magic_link_sent`               | user_id, channel (email), ts                                                            |
| `magic_link_used`               | user_id, ts                                                                             |
| `session_created`               | user_id, sid, device_id, ts                                                             |
| `session_terminated`            | user_id, sid, reason (logout/force/expiry/theft_detected), ts                           |
| `refresh_token_rotated`         | user_id, sid, ts                                                                        |
| `refresh_token_theft_detected`  | user_id, sid, ts                                                                        |
| `account_linked_auto`           | user_id, provider, ts                                                                   |
| `account_link_attempt_rejected` | user_id, provider, reason, ts                                                           |
| `account_unlinked`              | user_id, provider, by_self/by_admin, ts                                                 |
| `role_granted`                  | user_id, role, by_admin, ts                                                             |
| `role_revoked`                  | user_id, role, by_admin, ts                                                             |
| `lockout_triggered`             | user_id, reason, ts                                                                     |
| `lockout_released`              | user_id, by_admin/auto, ts                                                              |
| `idp_sync_drift_detected`       | user_id, diff, ts                                                                       |
| `right_to_erasure_executed`     | user_id, scope, ts                                                                      |

Storage — append-only Postgres table или event-store (если IdP = Zitadel — нативно event-sourced). Read access — только `platform_admin` + DPO; delete не разрешён даже им (enforced на DB-уровне).

### 7.4. Открытый вопрос (Phase 0 implementation)

Где живёт session store — внутри IdP или общий backend Redis. Default — внутри IdP. Решение зависит от headless API ergonomics обоих кандидатов (выясняется в спайке). Это **не блокер дизайна** — force-logout гарантия одинакова в обоих вариантах (15-мин window для access + introspection для high-stakes).

### 7.5. Cross-app SSO via OIDC silent re-auth (DSO-63 #2, ADR-0001 Amendment A2)

После reverse Amendment A1 (DSO-63 #2) cross-app login continuity между portal, admin, promo, docs, cms — **не shared cookie на `.doctor.school`**, а OIDC silent re-auth у IdP.

**Flow для пользователя, уже залогиненного на portal, открывающего admin:**

1. Browser → `admin.doctor.school`.
2. Admin Next.js middleware проверяет local host-only cookie `__Host-ds_admin_session`. Отсутствует / просрочена.
3. Middleware делает `302 → auth.doctor.school/oauth/authorize?client_id=admin&prompt=none&redirect_uri=https://admin.doctor.school/auth/callback&state=...`.
4. IdP проверяет свою host-only сессию (cookie на `auth.doctor.school`). Сессия активна.
5. IdP выдаёт `authorization_code` → редирект обратно на `admin.doctor.school/auth/callback?code=...`.
6. Admin server обменивает code на app-specific token, ставит свою `__Host-ds_admin_session` cookie.
7. Пользователь видит admin UI. **Visible delay ≤300ms**, без явного login screen.

**Если IdP-сессии нет** (пользователь не залогинен где-либо вообще): IdP возвращает `error=login_required` → admin Next.js redirects к стандартному login flow (auth.doctor.school/login).

**Требования к IdP** (критерии для DSO-25 spike):

- `prompt=none` поддерживается (silent re-auth).
- Multiple `redirect_uri` allowed per OAuth client, **или** multiple OAuth clients (по одному на subdomain) — design choice in spike. Multiple clients чище для blast-radius isolation.
- Cookie IdP-сессии — host-only (без `Domain=`), `SameSite=Lax` или `Strict`.

**Authentik / Zitadel / Keycloak** — все три поддерживают. Не сужает shortlist.

**Logout:**

- App-level logout: DELETE cookie на одном subdomain → пользователь логаут только на этом app, остальные продолжают работать через silent re-auth.
- Global logout: IdP endpoint `/oidc/logout` инвалидирует IdP-сессию → silent re-auth на других apps возвращает `login_required` → они логаутят локально.
- "Logout from all devices" — IdP admin API revoke all sessions for user.

---

## 8. Миграция identity из Directual

### 8.1. Phases

```
Phase 0: Discovery (2–3 недели — пересмотрено)
  - Прямой API-call к Directual: реальный count App users (закрывает open question §9.10/1 inventory)
  - Schema dump user-объектов: hash format паролей, поля, ролевая структура
  - Inventory ролей и manager-связей (manager1_user → backend hierarchy table)
  - Legal review: текущий 152-ФЗ consent покрывает миграцию в новую инфру и нового оператора? Если нет — план re-acquisition (см. §8.4).
  - Артефакт: discovery-report в outputs/

Phase 1: Test migration (1–2 недели)
  - Dry-run import 100 users в staging IdP
  - Проверка password verification на bcrypt-hash транзитом (если совместимо)
  - Mapping legacy admin-users → временная `legacy_admin` группа
  - MFA bootstrap flow для legacy admin (см. §8.5)
  - Контракт-тесты login flow

Phase 2: Bulk migration (cutover weekend)
  - Production Directual → read-only freeze (включая manager_hierarchy — freeze structural data)
  - Bulk import всех users в production IdP:
    - Hash-compatible → as-is (zero friction)
    - Hash-incompatible → флаг `pending_migration`, без пароля
  - Product-роли (active v1: `doctor`, `doctor_guest`, `guest`) → IdP groups
  - Legacy admin-users → временная `legacy_admin` группа с read-only permissions
  - Manager-иерархия (`manager1_user`) → backend table `manager_hierarchy`
  - Auth audit log freeze + новый поток в новый audit log
  - Switch traffic на новую платформу

Phase 3: Soft migration window (90 дней — пересмотрено с 30)
  - Hash-compatible — логин обычный
  - Hash-incompatible — три волны email-кампании: day 0, day 14, day 45
  - Tracking: реактивированные vs dormant
  - Consent re-acquisition (если требуется по Phase 0 legal review) — при первом логине врача показывается обновлённое согласие, отказ → блокировка с recovery-flow

Phase 4: Sunset (после 95% или 120 дней — пересмотрено с 60)
  - Directual full shutdown
  - Dormant users (~30–50% от base — реалистичный, не оптимистичный, target) остаются с `dormant` флагом, recovery через магик-линк навсегда
  - Bubble + Directual + sync cronTasks выключены
```

### 8.2. Hash-format compatibility

| Hash в Directual              | Authentik                             | Zitadel             |
| ----------------------------- | ------------------------------------- | ------------------- |
| bcrypt                        | ✅ Native                             | ✅ Native           |
| argon2                        | ✅ Native                             | ✅ Native           |
| PBKDF2                        | ✅ Native                             | ✅ Native           |
| scrypt                        | ✅ Native                             | ⚠️ Migration plugin |
| SHA-256 без соли / самописное | ❌ — option «magic-link reset» forced | ❌ — то же          |

Доля «zero-friction» миграции = определяется в Phase 0. **Reviewer-замечание принято: оптимистичный сценарий 90%+ bcrypt — не гарантия. Pessimistic сценарий (всё через magic-link reset) даёт reactivation ~20–40% в первом 30-дневном окне, поэтому базовый план — 90-дневное окно + три волны email.**

### 8.3. Что НЕ мигрирует

- **Audit log Directual** → архив 3-летней ретенции, новые события идут в новый audit log; continuity обеспечивается reference на UUID actor'а.
- **Magic-link tokens в полёте** → invalidate в момент cutover; юзер должен запросить новый.
- **Bubble shadow `id + role + is_speaker`** → не мигрирует (это derivative от Directual identity).
- **Bubble `Log the user in` race condition** (inventory §F1) — не воспроизводим как баг-paritet; в новой системе headless API имеет atomic session-creation.

### 8.4. 152-ФЗ compliance во время миграции

- Все скрипты выполняются **в RF** (Timeweb VPS или локально в RF).
- Directual API → новая IdP — оба эндпоинта RF-hosted.
- В migration-окне PII присутствует в обеих системах; шифрование at rest обязательно в обоих местах.
- Migration scripts логируются в отдельный audit-trail с retention 3 года (часть нового ledger).
- **Consent re-acquisition** (Phase 0 legal review закрывает): если действующее согласие врача не покрывает миграцию в новую инфру/нового оператора, при первом логине после cutover отображается обновлённое согласие. Отказ от согласия → user в статусе `consent_revoked`, доступ закрыт до решения через support.
- **Ledger балансы** (`dsCoinsTransaction`, `NmoPointsTrasaction`, `Crypto*`) — мигрируют отдельным треком (DSO-30), не identity. Для identity-слоя они — read-only метаданные user'а, не блокируют миграцию.

### 8.5. MFA bootstrap для legacy admin

**Bootstrap проблема (reviewer-замечание):** legacy admin-users в Directual логинились email+password без MFA. В новой системе `legacy_admin` группа требует MFA. **Как они войдут первый раз для enrollment?**

Flow:

1. Cutover → admin получает email с magic-link + инструкцией.
2. Magic-link даёт **single-use elevated session с TTL 1 час**, специально для MFA-enrollment. Этот flow помечен `mfa_pending_enrollment=true`.
3. В рамках этой сессии admin обязан enroll TOTP (или SMS для `moderator`/`support`); UI не даёт продолжить без enrollment.
4. После enrollment — сессия завершается, требуется повторный login с MFA.
5. Если admin не выполнил enrollment в окно (например, 7 дней) — статус → `mfa_enrollment_required`, требуется manual unlock через support / Tech Lead.

Это закрытый flow с audit-событиями `mfa_enrolled` + `lockout_triggered (mfa_enrollment_expired)`.

---

## 9. IdP shortlist — Authentik vs Zitadel

### 9.1. Equal capabilities OOB

Оба покрывают:

- Headless API для custom UI
- Magic-link + SMS-OTP + password + MFA per group
- OAuth2 generic sources (VK / Я / Max через config)
- PKCE для public clients (OOB)
- Telegram custom integration через flow stage / action (~50 строк кода в обоих)
- Multi-group membership + multi-role
- OIDC issuer для backend
- Admin UI для оператора
- 1 service + Postgres deployment
- MIT (Authentik) / Apache 2.0 (Zitadel) — оба permissive

### 9.2. Точки различия (определяются спайком)

| Критерий                                   | Authentik                                                                  | Zitadel                                  |
| ------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------- |
| Stack                                      | Python/Django                                                              | Go event-sourced                         |
| Multi-tenancy                              | Через `organizations` field                                                | First-class (нам не нужно, но не блокер) |
| Event-sourced audit                        | Стандартный audit log                                                      | Всё в event store                        |
| Headless API ergonomics                    | Flow executor — stage-based JSON                                           | gRPC + REST sessions — чище API surface  |
| Battle-testedness self-hosted              | Больше production deployments                                              | Меньше, но активно растёт                |
| Backup/restore complexity                  | Стандартный SQL dump                                                       | Event-store replay (сложнее DR)          |
| Vendor commercial push                     | Минимальный managed-push (BeryJu GmbH, DE)                                 | Активный (Zitadel Cloud — CAOS AG, CH)   |
| Русскоязычная документация / РФ-сообщество | Больше                                                                     | Меньше                                   |
| Sanctions exposure                         | Оба EU-based, MIT/Apache → код доступен даже при отзыве commercial support | Тот же риск                              |

### 9.3. Spike critères (Phase 0 implementation)

| Тест                                                                   | Время          | Закрывает вопрос                  |
| ---------------------------------------------------------------------- | -------------- | --------------------------------- |
| Реализовать login phone-OTP + magic-link end-to-end через headless API | 2–4ч/кандидата | Headless API ergonomics           |
| Интегрировать РФ SMS-провайдера (SMSC.ru / SMS.ru) через webhook       | 1–2ч/кандидата | Custom provider integration       |
| Реализовать Telegram Login HMAC                                        | 1–2ч/кандидата | Custom auth-stage complexity      |
| Bulk-import 100 users из Directual через admin API                     | 1–2ч/кандидата | Migration tooling                 |
| Webhook outbox-pattern прогон (`user.*` events)                        | 1ч/кандидата   | Sync-стратегия §3.2 жизнеспособна |
| Account-linking PKCE-flow с pre-auth takeover scenario                 | 1ч/кандидата   | §6.2 guards реализуемы            |
| Deploy + backup/restore прогон на Timeweb                              | 1–2ч/кандидата | Ops ergonomics + DR               |

**Бюджет:** 1.5 рабочих дня на кандидата = 3 дня (пересмотрено с 2). Решение — ADR в `docs/adr/` по итогам спайка.

---

## 10. Risks и open questions

### 10.1. Risks

| Risk                                                                 | Impact                                          | Mitigation                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Directual password hash формат самописный / SHA-256                  | Forced reset, reactivation 20–40% в 30 дней     | 90-дневное окно + три волны email; explicit ожидание dormant 30–50%               |
| Telegram Login Widget HMAC custom — баг в реализации                 | Telegram auth не работает / security hole       | Спайк включает Telegram-flow; reference implementations                           |
| Apple Developer Program registration для РФ-юрлица                   | Блокирует v3 mobile SIWA                        | Параллельный legal-track                                                          |
| SMS-провайдер РФ rate-limited / отказ                                | Phone-OTP login недоступен                      | Failover 2 SMS-провайдера (digest §2) + global circuit-breaker (§5.5)             |
| Реальное число врачей в Directual оказывается 65k+                   | Migration logistics больше                      | Phase 0 discovery даёт точный count                                               |
| Webhook IdP → backend missed → audit-actor mismatch                  | Compliance-инцидент                             | Reconciliation cron §3.2 + audit `idp_sync_drift_detected`                        |
| SMS toll-fraud attack (зараженный IP × массовые номера)              | Бюджетные потери до десятков тысяч ₽/час        | Multi-layer rate limit + global budget circuit-breaker (§5.5)                     |
| Pre-auth account takeover через OAuth email-claim                    | CVSS 9.0+, hijacking 10k+ аккаунтов             | §6.2 guards (verified-verified требование), audit `account_link_attempt_rejected` |
| MFA bootstrap для legacy admin застрял (7 дней без enrollment)       | Поломка cutover для критических операторов      | §8.5 manual unlock flow через support / Tech Lead                                 |
| Consent re-acquisition отказы при первом логине                      | Loss доступа для compliant pool                 | Legal review в Phase 0; UI-flow с возможностью recovery                           |
| Yandex SmartCaptcha rate limit / downtime                            | Login без bot-protection                        | Fallback: временная блокировка login endpoint при недоступности captcha + alert   |
| Sanctions ужесточение → Authentik/Zitadel commercial support отозван | Self-host остаётся (OSS), но без vendor support | Зафиксировано в ADR как known risk; fork-ready strategy                           |

### 10.2. Open questions (закрываются вне DSO-25)

1. Финальный выбор Authentik vs Zitadel — Phase 0 spike (~3 дня).
2. Конкретный SMS-провайдер РФ + failover-схема — DSO-26.
3. Session store: внутри IdP или общий backend Redis — Phase 0 implementation.
4. Policy engine для backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
5. Реальный count + hash format в Directual — Phase 0 discovery.
6. Apple Developer Program registration юр.лицо — параллельный legal track.
7. **Целевая admin/operational-ролевая модель DS Platform** — продуктовая задача (DSO-26 + ops), отдельно от identity-слоя.
8. Bot-protection provider в РФ — default Yandex SmartCaptcha, альтернативы (ru-cap, self-hosted invisible CAPTCHA) — DSO-26.

### 10.3. Deferred gaps (не блокер DSO-25, но обязательны до v2)

| Gap                                                                                                | Owner                   | Когда                                                   |
| -------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| Consent management подсистема (`consent_history`, версионирование политик)                         | DSO-26                  | До v2                                                   |
| Right-to-erasure flow (PRD §31, digest §3.3)                                                       | DSO-26                  | До v2                                                   |
| ФЗ-187 (КИИ) compliance анализ                                                                     | Compliance track        | До v2 при достижении значимого объёма ПД                |
| ФСТЭК-17/21 классы защиты + сертифицированная криптография (ГОСТ 28147 / Кузнечик) для PII at rest | Compliance track        | При Росздравнадзор интеграции (digest §2/integration 1) |
| HIBP Pwned Passwords k-anonymity check на регистрации                                              | DSO-26                  | v2                                                      |
| Anomaly detection / impossible travel                                                              | DSO-26 + DSO-30 (AI/ML) | v3                                                      |
| OWASP ASVS Level 2/3 audit + MASVS Level 2 для mobile                                              | External pen-test       | Перед v2 release (PRD §31.4)                            |
| DPoP (RFC 9449) / sender-constrained refresh tokens для mobile                                     | DSO-26                  | v2 (v1 — device-id binding)                             |
| WebAuthn / Passkeys                                                                                | DSO-26                  | v2                                                      |

---

## 11. Артефакты и связи

| Артефакт           | Локация                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| Этот design spec   | `apps/docs/content/adr/0001-identity-provider-shortlist-design-ru.md`                  |
| ADR                | `apps/docs/content/adr/0001-identity-provider-shortlist-ru.md`                         |
| Plane DSO-25       | `0a8f2276-956f-4f4e-9134-2f197ff4bab8`, project `6ff068e6-c73a-4a5e-923d-90b7dae1daac` |
| Inputs (digest v2) | `outputs/2026-05-12-ds-platform-tech-requirements-digest.md`                           |
| Inputs (inventory) | `outputs/2026-05-12-ds-platform-inventory.md`                                          |
| Brainstorm prep    | `outputs/2026-05-12-tech-stack-brainstorm-prep.md`                                     |

### 11.1. Что разблокировано

- **DSO-26 (backend core)** — теперь знает: RBAC layering hybrid; backend владеет policy engine + object-level + domain audit log; backend mirror users-table с outbox/reconcile (§3.2); auth integration через JWT fast-path + introspection для high-stakes (§7.2); список обязательных audit-событий (§7.3); security baseline (§5.5) реализуется в API gateway + backend; deferred gaps (§10.3) — consent management, right-to-erasure, HIBP, pen-test gates.
- **DSO-28 (frontend)** — теперь знает: все auth-формы — наши, headless паттерн (§4.1); social — IdP-managed sources с PKCE; auth subdomain `auth.doctor.school`; cookie security profile (`__Host-` + SameSite=Lax + HttpOnly).
- **DSO-29 (mobile)** — теперь знает: phone-OTP primary + biometric unlock + secure token storage; refresh 14d с device-id binding; OAuth flow через ASWebAuthenticationSession/Custom Tabs с PKCE; DPoP — на v2.
