---
title: "ADR-0001 — Identity / Auth / RBAC для DS Platform [RU]"
description: "DS Platform — самостоятельная платформа, заменяющая текущий Bubble + Directual + Supabase стек. Нужна identity-инфраструктура, поддерживающая:"
lang: ru
---

> **EN:** [`0001-identity-provider-shortlist-en.md`](./0001-identity-provider-shortlist-en.md) · **RU (this)**

# ADR-0001 — Identity / Auth / RBAC для DS Platform

**Дата:** 2026-05-25 (текущая редакция; полная история эволюции — в `git log`).
**Статус:** Accepted — IdP = Zitadel
**Связан с:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24, DSO-63 (внешняя валидация), DSP-209 (IdP финальный выбор)
**Design spec:** `apps/docs/content/adr/0001-identity-provider-shortlist-design-ru.md`

---

## Context

DS Platform — самостоятельная платформа, заменяющая текущий Bubble + Directual + Supabase стек. Нужна identity-инфраструктура, поддерживающая:

- ~10–65k существующих врачей (миграция из Directual) + рост до 1M MAU в v3.
- 9 product-ролей (PRD §13) + admin/operational-роли (целевая модель — продуктовая задача, **не 1:1 миграция** 7 ролей из Directual), multi-role per user.
- email + phone + magic-link + 2FA (TOTP/SMS).
- РФ-OAuth (VK ID, Yandex ID, Telegram) с v2; Apple Sign-In с v3 при iOS App Store distribution.
- Headless UI на нашем домене (не IdP-hosted login pages).
- 152-ФЗ — hosting в RF, ПД врачей не покидают RF-контур.
- AI-agent driven разработка — стек должен быть LLM-friendly.
- Эксплуатация командой 1–2 человек.

## Decision

### 1. RBAC = гибрид

- IdP хранит coarse roles в v1: `guest`, `doctor_guest`, `doctor`, `legacy_admin`, `platform_admin` (минимизация — остальные группы из 9 product-ролей добавляются инкрементально по мере появления функционала: `expert/moderator/support/investor` в v2, `clinic_admin` в v3).
- Целевая admin/operational-ролевая модель — параллельный продуктовый track (не блокер identity-слоя).
- Backend хранит fine-grained и object-level permissions + domain audit log (append-only, 3-летняя ретенция).
- JWT claims минимальные: `sub`, `roles[]`, `mfa`, `sid`, `iat`, `exp`, `jti`. Никаких `permissions[]` в токене.
- PD lifecycle, consent, retention, erasure — см. ADR-0009.

### 2. UI — headless для credentials, near-headless для social

- Credentials (login/register/reset/MFA/magic-link) — формы на `doctor.school` через IdP headless API.
- Social — classic OAuth Authorization Code Flow + PKCE с redirect через `auth.doctor.school` (наш subdomain). 1-сек видимый hop под нашим брендом.

### 3. Identifiers = dual + UUID PK

- UUID — единственный FK-ключ.
- Phone и email оба unique, оба login-методы.
- Phone-first UX на mobile/doctor-flow, email-first на admin/expert-flow.
- CHECK constraint `phone OR email NOT NULL`.

### 4. Auth-методы v1

email+password, email+magic-link, phone+SMS-OTP, biometric unlock (mobile, локальный):

- **MFA TOTP обязательно** для `expert / clinic_admin / investor / platform_admin`.
- **MFA SMS acceptable trade-off** для `moderator / support` в v1 (low-cardinality, low ops-capacity); upgrade на TOTP в v2.

### 5. OAuth — phased rollout

| Этап          | Providers                            |
| ------------- | ------------------------------------ |
| v1            | — (без social)                       |
| v2            | VK ID, Yandex ID, Telegram Login     |
| v3 mobile     | + Apple Sign-In (если iOS App Store) |
| По требованию | Max ID, Google                       |

Обоснование откладывания: v1 user-base ≤200 из существующей Doctor.School базы — у всех уже email-аккаунты, social не даёт incremental conversion. Решение остаётся переоткрываемым, если product-команда даст evidence-обоснование на A/B прототипа.

**Account linking требует verified-email с обеих сторон** (защита от pre-auth account takeover, CVSS 9.0+). См. spec §6.2.

### 6. Tokens — OAuth 2.0 BCP (RFC 9700)

- Access: JWT 15 мин, RS256/ES256.
- Refresh: opaque, rotating single-use, **30d web / 14d mobile** (пересмотрено с 90d).
- **PKCE обязателен** для public clients (mobile + SPA web).
- **Sender-constrained refresh для mobile:** device-id binding в v1, DPoP (RFC 9449) — в v2.
- Session store: Redis, server-side. Force-logout = DELETE session.
- **Two-tier validation:** JWT fast-path для ≥99% запросов (read + low-stakes write); IdP `/introspect` (RFC 7662) для <1% high-stakes endpoints (payments, AU withdrawal, role-change, admin mutations, PII export).
- **Step-up authentication** для действий повышенного риска (admin user-management writes, account/erasure execution, payment-method change, MFA change, role grant/revoke, logout-all) — отдельный elevated session со свежим MFA, TTL 30 мин, claim `acr=mfa-fresh`. Полная политика — §10.
- Mobile storage — Keychain/Keystore; web — HttpOnly + Secure + SameSite=Lax cookie с `__Host-` prefix (НЕ localStorage). **Каждое приложение (portal, admin, promo) держит свою host-only session cookie**, scoped только на свой origin; cross-app SSO continuity достигается через OIDC silent re-auth (`prompt=none`) у IdP. Shared cookie через границы trust-zone (например, `__Secure-ds_session` на `.doctor.school`) отвергается: same-origin XSS или subdomain takeover в любом субдомене скомпрометирует admin-сессию, а стандартные mitigations (fingerprint binding, CSRF double-submit) обходятся same-origin XSS.
- **Fingerprint binding (обязательно):** метаданные сессии ОБЯЗАНЫ содержать стабильный client fingerprint = hash(UA + IP /24 + accept-language); при mismatch сессия инвалидируется и пользователь проходит re-auth через IdP. Это не защита от same-origin XSS (см. выше), а базовый барьер против replay украденной cookie с другого network/UA.
- JWKS rotation — graceful overlap window 24ч.

### 7. Security baseline (mandatory for v1)

- Rate limiting: per-user (5 попыток / 15 мин), per-IP (20 / 15 мин), per-ASN (100 / hour).
- SMS toll-fraud защита: per-phone (3/hour) + per-IP (10/hour) + per-ASN (100/hour) + **global daily budget circuit-breaker** (≤2000 SMS/день).
- Account lockout: 10 failed login / 30 мин → soft-lock + email notification.
- Refresh token theft detection: re-use → invalidate цепочки (RFC 6819).
- Email/phone enumeration protection: idempotent responses на login/reset/register с timing delta ≤50ms.
- CAPTCHA: **Yandex SmartCaptcha** (RF-доступная; hCaptcha/reCAPTCHA deprecated в РФ).
- CSRF protection + cookie security profile (`__Host-` per app, no shared cookies между субдоменами — см. §6; полный security profile описан здесь, не дублируется во frontend-spec).
- **Content Security Policy (CSP) profile-per-zone** — обязательная защита от XSS/clickjacking, дифференцирована по уровню чувствительности зоны:

| Zone                          | Профиль              | Особенности                                                                                                                                                   |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.doctor.school`         | strictest            | `default-src 'self'`; no `unsafe-inline`, no `unsafe-eval`, no 3rd-party origins (включая analytics); strict nonce-based script-src; `frame-ancestors 'none'` |
| `portal.doctor.school` (app)  | standard             | `default-src 'self'`; allow Centrifugo WS endpoint, Timeweb CDN, Sentry, разрешённые embed origins (видео-провайдеры из CMS); nonce-based scripts             |
| `doctor.school` (promo SSG)   | relaxed              | разрешает analytics (Plausible self-hosted), pixel-marketing endpoints (если будут); все равно no `unsafe-eval`; `frame-ancestors 'none'`                     |
| `docs.doctor.school`          | Fumadocs default     | поверх — наш `report-uri`; никаких исключений для admin/portal/promo                                                                                          |
| `cms.doctor.school` (Payload) | strict (admin-level) | по аналогии с admin; редакторы внутри VPN/IdP только                                                                                                          |

Cross-zone constraints: все профили отдают `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. CSP-violations со всех зон уходят на единый `csp-report-collector` endpoint (`apps/api/`-level), пишутся в `audit_log` + alerting в Sentry на pattern-spikes. Admin zone дополнительно отдаёт `Permissions-Policy: geolocation=(), microphone=(), camera=()`. Конкретные `default-src` / `script-src` / `style-src` / `img-src` / `connect-src` / `frame-ancestors` / `form-action` / `report-uri` directives — frontend design spec §3.2 + §3.2.2; они могут эволюционировать как operational change, но изменение профилей-зон или релакс-уровней требует новой редакции ADR.

- PII в логах маскируется; полные значения только в шифрованном audit log с RF-resident KMS.
- Полный список обязательных auth audit-событий — spec §7.3.

### 8. IdP — Zitadel

**Решение.** IdP для DS Platform — **Zitadel** (2026-05-25, DSP-209). Закрыто desk-research'ем; hands-on спайк не выполнялся.

**License discipline (AGPL 3.0).** Zitadel сменил лицензию Apache 2.0 → AGPL 3.0 в 2025. Source-disclosure обязательство (§13 AGPL) срабатывает ТОЛЬКО при патче исходников Zitadel с network-доступом для юзеров. Для self-host без модификаций практическая разница с MIT = 0. Норма:

- ✅ Разрешено: deploy, configure, integrate via API/gRPC/REST, custom Actions (JS-хуки в Zitadel — application code, не модификация исходников), кастомный фронт, branding.
- ⚠️ Триггер AGPL §13: патч в src Zitadel → обязаны offer modified source юзерам, которые взаимодействуют через сеть (public git mirror покрывает).
- 🛡 Дисциплина: баги фиксим upstream PR'ом или обходим через Action/config; src не патчим. Это часть Definition of Done для любого Zitadel-related PR.

**Known trade-offs.**

- Magic-link строится кастомом на session API (~1–2 дня; не core-фича Zitadel, GitHub #2075). Security-review обязателен.
- Self-hosted база Zitadel ~13.4k★ — в v1 ≤200 юзеров не давит; пересмотр триггерится только если в v2+ возникнут production-проблемы зрелости.

#### Отвергнутые кандидаты

Keycloak, Authentik, Ory Kratos, Authelia, Logto, FusionAuth, SuperTokens рассматривались. Полное обоснование по каждому кандидату, методология scoring (гейты / 7 взвешенных дифференциаторов / evidence URLs) и история решения — в bbm `decisions-log.md` [2026-05-25]. Операционный fallback: Keycloak при критических проблемах с Zitadel (наиболее зрелая OSS-альтернатива).

**Consequences.** DSP-157 (local-dev compose IDP) разблокирован.

### 9. Миграция из Directual — hard domain cutover (изменено 2026-05-18, DSO-63 #4)

**Модель:** жёсткое переключение DNS/auth-redirect с Directual на новый стек. Юзеры физически не имеют доступа к Directual после переключения. **Никакого dual-system PII периметра не существует** — БД мигрируется единократно, legal-доступ только в новой системе.

- **Pre-cutover** (Phase 0 discovery, 2–3 недели): count + hash format + consent re-acquisition strategy. PD export из Directual → staging новой системы (encrypted at rest, restricted access).
- **Hash-compatibility decision:** старый bcrypt cost compatibility check → решение «use-as-is» (silent first-login) или «forced password reset» (magic-link на первый логин). Решается до cutover.
- **Notification campaign:** трёхэтапная (T-14d / T-3d / T-0) email + SMS-уведомления о переключении домена и first-login требованиях.
- **Cutover window** (часы): DNS / auth-redirect перенаправляются на новый стек. Directual блокирует пользовательский доступ (read-only либо off). Финальная синхронизация delta (если применимо).
- **First-login flow** на новом стеке: магик-линк/SMS-OTP → consent re-capture (per-purpose, версия v1, см. ADR-0009) → (опционально) password set.
- **Sunset criteria:** Directual окончательно выключается при достижении X% активных пользователей через новый стек (target ≥50%) ИЛИ при истечении 120 дней с момента cutover (whichever first). Подписывается data deletion certificate с legal sign-off.

**Operational artifact:** `Directual hard cutover runbook + first-login spec` — DSO-задача (см. DSO-63 findings #4), готовится до момента готовности нового стека.

**MFA bootstrap для legacy admin** — отдельный flow elevated-session magic-link → принудительный TOTP/SMS enrollment в 7-дневное окно, иначе manual unlock через support (spec §8.5).

### 10. Step-up authentication для high-risk actions

Базовая session, выданная после первичного login (§6), несёт общий security level, единый для read- и write-операций любого назначения. Для действий повышенного риска — деструктивных admin-операций над пользователями (role grant/revoke, lock, erasure-execute), account-level deletion / erasure-request от subject'а, payment-method change, изменения MFA, инициирования PD export, logout-all — общего level недостаточно: атакующий с украденной long-lived session не должен иметь возможности немедленно выполнить катастрофическое действие без свежей re-аутентификации.

Список endpoint-классов, требующих step-up, нормативно зафиксирован в **endpoint-authorization-matrix-design §8.1** (`auth: 'step-up'` декларация в `@Authz`). Триггер step-up — OIDC `prompt=login` + `acr_values=urn:ds:acr:mfa-fresh` на IdP. После успешного step-up IdP issues access-token с дополнительным claim `acr=mfa-fresh` и `mfa_fresh_at` timestamp; TTL свежего step-up — **30 минут** (см. identity-auth-rbac-design §7.1).

Backend обязан проверять `acr=mfa-fresh` AND `mfa_fresh_at ≥ now − 30 мин` на всех endpoints с `auth: 'step-up'` через единый `StepUpGuard` middleware (см. endpoint-authorization-matrix-design §8.2 + backend-core middleware checklist). При неуспехе — `401 Unauthorized` с телом `{ error: 'step_up_required', step_up_url: '<IdP authorize URL с prompt=login + acr_values + redirect_uri + state>' }`. Этот контракт ошибки — нормативный (endpoint-authz-matrix-design §8.2), frontend и mobile обязаны его обрабатывать.

**Session lifetime после step-up.** Elevated state — это **отдельный claim в access-token**, не отдельная session. Базовая session (refresh-token web 30d / mobile 14d, §6) продолжает существовать независимо: elevated TTL 30 мин истекает быстрее access-token TTL (15 мин), но обновление access-token через refresh-token не возвращает `acr=mfa-fresh` автоматически — после истечения elevated окна следующий high-risk action заново требует step-up. Step-up не продлевает базовую session expiration.

**IdP requirements.** `prompt=login` + custom `acr_values` поддерживаются Zitadel (§8).

**UX implications.** Frontend (portal/admin/cms) обязан перехватывать `401 step_up_required`, выполнять redirect на `step_up_url` без потери текущего context (preserved через `state` параметр + client-side route restoration после возврата с auth code), обменивать code на обновлённый access-token и retry оригинального request. Mobile — тот же flow через `ASWebAuthenticationSession` (iOS) / `Custom Tabs` (Android). Серия step-up-операций в пределах 30-минутного окна не требует повторной аутентификации (UX-критично для admin-консоли).

**Audit.** Каждая step-up попытка (success + fail) обязана писаться в `audit_ledger` (ADR-0003 §6, ADR-0009 §2.4 — audit class `auth.step_up.{requested,succeeded,failed}`) с полями `user_id`, `endpoint`, `acr_before`, `acr_after`, `mfa_method`, `ip`, `ua`. Полный список auth audit-событий — identity-auth-rbac-design §7.3.

**Forward references:**

- **endpoint-authorization-matrix-design §8** — step-up policy, список endpoints, механика 401-ответа, `StepUpGuard` checklist.
- **backend-core-design** — middleware-stack для `auth: 'step-up'` (CI rule на наличие `StepUpGuard` для каждого endpoint с `auth: 'step-up'` декларацией).
- **identity-auth-rbac-design §7.1** — `acr=mfa-fresh` claim, TTL, MFA-elevated session.
- **ADR-0009 §2.4** — audit class регистрация для step-up событий.

## Consequences

### Положительные

- Smena IdP в будущем дешевле — backend RBAC изолирован за тонким SSO-слоем.
- Object-level и fine-grained permissions масштабируются без cardinality explosion в IdP groups.
- Audit log живёт рядом с domain-объектами — 152-ФЗ-комплаентность по умолчанию.
- Phased OAuth rollout экономит ~неделю разработки в v1.
- UUID-PK защищает от ломки FK при смене phone/email пользователя.
- Two-tier JWT/introspection model даёт stateless-скорость 99% запросов + statefulness где материально.
- Минимизация IdP-групп в v1 (5 вместо 9) сокращает migration complexity.

### Отрицательные

- Дублирование users-таблицы (IdP + backend mirror через webhook + reconciliation cron). Требуется обработка eventual-consistency (spec §3.2).
- Two-tier validation: backend должен правильно классифицировать high-stakes endpoints; ошибка классификации → security gap или performance hit.
- Hard cutover Directual (см. §9): pre-cutover PD export требует encrypted-at-rest staging + restricted access; sunset Directual после 50% migration или 120 дней.
- Решение закрыто desk-research'ем (без hands-on валидации); оставшиеся known trade-offs перечислены в §8 (custom magic-link, меньшая self-hosted база).
- MFA SMS для `moderator`/`support` в v1 — известный downgrade против NIST SP 800-63B; mitigation планируется в v2.

## Open questions (deferred)

1. Session store: внутри IdP или общий backend Redis — Phase 0 implementation.
2. Policy engine для backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
3. SMS-провайдер РФ + failover-схема — DSO-26.
4. Apple Developer Program registration для РФ-юрлица — параллельный legal track.
5. Реальный count + hash format в Directual + consent re-acquisition план — Phase 0 discovery.
6. **Целевая admin/operational-ролевая модель DS Platform** — параллельный product-track (вне DSO-25).
7. Bot-protection provider в РФ — default Yandex SmartCaptcha, альтернативы — DSO-26.

## Deferred gaps (известны)

| Gap                                          | Owner                           | Когда                       | Статус (на 2026-05-18, DSO-63)                                                                       |
| -------------------------------------------- | ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Consent management подсистема                | ADR-0009 + DSO-X (PD lifecycle) | Pre-pilot launch gate       | **Closed by ADR-0009** — design spec покрывает versioning, capture, withdrawal                       |
| Right-to-erasure flow                        | ADR-0009                        | Pre-pilot launch gate       | **Closed by ADR-0009 §2.3 + §2.4** — three erasure levels + crypto-shred                             |
| ФЗ-187 (КИИ) compliance анализ               | —                               | —                           | **N/A** — DS Platform не является объектом КИИ (DSO-63 #7)                                           |
| ФСТЭК-21 + классификация ИСПДн (УЗ-3)        | DSO-X (legal track)             | Pre-pilot launch gate       | **In progress** — DSO-задача создана; архитектура спроектирована под УЗ-3 (engineering-readiness §5) |
| РКН-уведомление об обработке PD              | DSO-X (legal track)             | Pre-pilot launch gate       | **In progress** — параллельный legal track                                                           |
| HIBP Pwned Passwords check                   | DSO-26                          | v2                          | (без изменений)                                                                                      |
| Anomaly detection / impossible travel        | DSO-26 + DSO-30                 | v3                          | (без изменений)                                                                                      |
| OWASP ASVS L2/3 audit + MASVS L2 mobile      | External pen-test               | Перед v2 release            | (без изменений)                                                                                      |
| DPoP / sender-constrained refresh для mobile | DSO-26                          | v2 (v1 — device-id binding) | (без изменений)                                                                                      |
| WebAuthn / Passkeys                          | DSO-26                          | v2                          | (без изменений)                                                                                      |
| MFA upgrade `moderator`/`support` SMS→TOTP   | DSO-26                          | v2                          | (без изменений)                                                                                      |
