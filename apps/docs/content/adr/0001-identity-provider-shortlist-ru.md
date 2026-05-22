---
title: "ADR-0001 — Identity / Auth / RBAC для DS Platform [RU]"
description: "DS Platform — самостоятельная платформа, заменяющая текущий Bubble + Directual + Supabase стек. Нужна identity-инфраструктура, поддерживающая:"
lang: ru
---

> **EN:** [`0001-identity-provider-shortlist-en.md`](./0001-identity-provider-shortlist-en.md) · **RU (this)**

# ADR-0001 — Identity / Auth / RBAC для DS Platform

**Дата:** 2026-05-12 (v2 — после независимого арх-ревью); последняя правка 2026-05-18 (Amendment A2, DSO-63 #2/#4; Amendment A3 (2026-05-18, DSO-63 #5/#6 — PD lifecycle → ADR-0009); Amendment A4 (2026-05-18, DSO-63 follow-up — step-up auth))
**Статус:** Accepted (shortlist), финальный выбор IdP — спайк ~3 дня в Phase 0 implementation
**Связан с:** Plane DSO-25 (`0a8f2276-956f-4f4e-9134-2f197ff4bab8`), milestone DSO-24, DSO-63 (внешняя валидация)
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
- **Step-up authentication** для действий повышенного риска (admin user-management writes, account/erasure execution, payment-method change, MFA change, role grant/revoke, logout-all) — отдельный elevated session с свежим MFA, TTL 30 мин, claim `acr=mfa-fresh`. См. Amendment A4.
- Mobile storage — Keychain/Keystore; web — HttpOnly + Secure + SameSite=Lax cookie с `__Host-` prefix (НЕ localStorage). **Каждое приложение (portal, admin, promo) держит свою host-only session cookie**; cross-app SSO continuity достигается через OIDC silent re-auth (`prompt=none`) у IdP — см. Amendment A2 (которое отменяет ранее принятое Amendment A1.1 о shared cookie `__Secure-ds_session` на `.doctor.school`).
- JWKS rotation — graceful overlap window 24ч.

### 7. Security baseline (mandatory for v1)

- Rate limiting: per-user (5 попыток / 15 мин), per-IP (20 / 15 мин), per-ASN (100 / hour).
- SMS toll-fraud защита: per-phone (3/hour) + per-IP (10/hour) + per-ASN (100/hour) + **global daily budget circuit-breaker** (≤2000 SMS/день).
- Account lockout: 10 failed login / 30 мин → soft-lock + email notification.
- Refresh token theft detection: re-use → invalidate цепочки (RFC 6819).
- Email/phone enumeration protection: idempotent responses на login/reset/register с timing delta ≤50ms.
- CAPTCHA: **Yandex SmartCaptcha** (RF-доступная; hCaptcha/reCAPTCHA deprecated в РФ).
- CSRF protection + cookie security profile (`__Host-` per app, no shared cookies между субдоменами — см. Amendment A2; полный security profile описан здесь, не дублируется во frontend-spec).
- **Content Security Policy (CSP) profile-per-zone** — обязательная защита от XSS/clickjacking, дифференцирована по уровню чувствительности зоны: admin (strictest, no inline, no unsafe-eval), portal (standard, allow specific 3rd-party origins), promo (relaxed, allow analytics/marketing pixels), docs (default Fumadocs profile). Конкретные directives — Amendment A1 + frontend design spec §3.2.
- PII в логах маскируется; полные значения только в шифрованном audit log с RF-resident KMS.
- Полный список обязательных auth audit-событий — spec §7.3.

### 8. IdP shortlist — **Authentik** или **Zitadel**

Финальный выбор откладывается до Phase 0 implementation spike. Бюджет: **~3 рабочих дня** (1.5 на кандидата). Критерии — headless API ergonomics, РФ SMS-провайдер integration, Telegram HMAC, bulk-import dry-run, **webhook outbox-pattern прогон**, **account-linking PKCE-flow с pre-auth takeover scenario**, ops ergonomics на Timeweb.

#### Отвергнутые кандидаты

- **Keycloak.** Зрелость огромная, RedHat-backed, в РФ-секторе значимая локальная экспертиза. Но: magic-link и SMS-OTP не из коробки — только через Java SPI extensions; JVM-эксплуатация (2GB+ heap, GC-тюнинг) ресурсоёмче на команду 1–2 чем Python/Go IdP'ы; admin-API ergonomic тяжелее. Это не disqualification, это trade-off против Authentik/Zitadel: на нашем сценарии (headless first, magic-link OOB, low-ops budget) Authentik/Zitadel выигрывают. Если на спайке оба отпадут — Keycloak fallback.
- **Ory Kratos.** Headless-first API лучший в классе. Но: **нет встроенного admin UI** — на команду 1–2 это означает написать admin tooling с нуля; multi-service deployment (Kratos + опц. Hydra/Oathkeeper/Keto) усложняет ops; vendor (Ory Inc) активно толкает managed Ory Network, self-hosted остаётся, но direction commercial.
- **Authelia.** Wrong category — это forward-auth proxy для защиты сервисов за nginx/Traefik, не full IdP. Нет self-signup, magic-link, SMS-OTP, social OAuth client, admin UI для users. Может использоваться отдельно для защиты internal tooling (Plane / Grafana / GlitchTip), но не для user-facing DS Platform identity.
- **Logto** (rejected after explicit review per арх-ревью). TS/Node, headless-first, MIT, лёгкий self-host. Сильный кандидат на бумаге. Отвергнут потому что: (а) меньше battle-testedness в self-hosted production (проект моложе Authentik/Zitadel/Keycloak); (б) SMS-OTP support менее зрелый — требует custom connector; (в) admin UI заявлен но менее богатый чем у Authentik. Возможен пересмотр в v2 если Authentik/Zitadel оба провалят спайк.
- **FusionAuth** (rejected after explicit review per арх-ревью). Headless API один из лучших, single-binary deploy, free self-hosted edition. Отвергнут потому что: (а) free edition имеет limits на advanced policy features (multi-tenancy, advanced threat detection) — может стать блокером на v2/v3; (б) Java/JVM-стек с теми же ops-costs что Keycloak; (в) commercial vendor (FusionAuth Inc, US) — sanctions exposure выше чем EU-based Authentik/Zitadel.
- **SuperTokens.** Headless, MIT, но фрагментированный SDK подход (auth-core отдельно от SDK-per-language) — приращивает complexity на наши custom форм-flows. Менее зрелый admin UI.

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
- Hard cutover Directual (Amendment по DSO-63 #4): pre-cutover PD export требует encrypted-at-rest staging + restricted access; sunset Directual после 50% migration или 120 дней (см. §9).
- Финальный выбор IdP отложен на ~3 дня спайка → milestone DSO-24 closure сдвигается на длительность спайка.
- MFA SMS для `moderator`/`support` в v1 — известный downgrade против NIST SP 800-63B; mitigation планируется в v2.

## Open questions (deferred)

1. Финальный выбор Authentik vs Zitadel — Phase 0 spike (~3 дня).
2. Session store: внутри IdP или общий backend Redis — Phase 0 implementation.
3. Policy engine для backend RBAC (Cerbos / OPA / OpenFGA / SQL) — DSO-26.
4. SMS-провайдер РФ + failover-схема — DSO-26.
5. Apple Developer Program registration для РФ-юрлица — параллельный legal track.
6. Реальный count + hash format в Directual + consent re-acquisition план — Phase 0 discovery.
7. **Целевая admin/operational-ролевая модель DS Platform** — параллельный product-track (вне DSO-25).
8. Bot-protection provider в РФ — default Yandex SmartCaptcha, альтернативы — DSO-26.

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

---

## Amendments

### A1 (2026-05-15, DSO-61) — SSO cookie carve-out + CSP profile-per-zone

Amendment объединяет два связанных уточнения security baseline, обнаруженных при cross-spec consistency analysis (DSO-61).

#### A1.1 — `__Secure-` carve-out для cross-subdomain SSO cookie [SUPERSEDED 2026-05-18 by Amendment A2]

> **Status: Superseded by Amendment A2 (DSO-63 #2).** Решение об использовании shared `__Secure-ds_session` cookie на `.doctor.school` для cross-app SSO отменено по результатам внешней валидации архитектуры. Текущая модель — host-only `__Host-` cookies per app + OIDC silent re-auth для cross-app continuity. См. Amendment A2.

**Историческое содержание (для контекста):** Amendment A1.1 ранее вводил carve-out — для SSO cookie между portal и promo допускался `__Secure-` prefix вместо `__Host-`. Mitigations включали: SameSite=Lax, fingerprint binding, CSRF double-submit, subdomain takeover protection.

**Причина отмены (DSO-63 #2):** shared cookie на trust-zone границы (admin/portal vs promo/marketing) делает безопасность admin зависимой от качества самого слабого субдомена. XSS или subdomain takeover в promo/docs компрометирует session admin. Mitigations (fingerprint binding, CSRF) обходятся same-origin XSS. Для медицинской платформы под 152-ФЗ это структурный дефект, не приемлемый compromise.

#### A1.2 — CSP profile-per-zone (новое требование §7)

**Что добавляется:** §7 Security baseline ранее не включал Content Security Policy. ADR-0004 §Context ссылался на «ADR-0001 §7 CSP profile-per-zone» — что отражало intent, но фактически в §7 CSP не было. Этот amendment закрывает дыру.

**Профили (минимальный baseline; конкретные `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `frame-ancestors`, `form-action`, `report-uri` directives — frontend design spec §3.2):**

| Zone                          | Профиль              | Особенности                                                                                                                                                   |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin.doctor.school`         | strictest            | `default-src 'self'`; no `unsafe-inline`, no `unsafe-eval`, no 3rd-party origins (включая analytics); strict nonce-based script-src; `frame-ancestors 'none'` |
| `portal.doctor.school` (app)  | standard             | `default-src 'self'`; allow Centrifugo WS endpoint, Timeweb CDN, Sentry, разрешённые embed origins (видео-провайдеры из CMS); nonce-based scripts             |
| `doctor.school` (promo SSG)   | relaxed              | разрешает analytics (Plausible self-hosted), pixel-marketing endpoints (если будут); все равно no `unsafe-eval`; `frame-ancestors 'none'`                     |
| `docs.doctor.school`          | Fumadocs default     | поверх — наш `report-uri`; никаких исключений для admin/portal/promo                                                                                          |
| `cms.doctor.school` (Payload) | strict (admin-level) | по аналогии с admin; редакторы внутри VPN/IdP только                                                                                                          |

**Cross-zone constraints:**

- Все профили: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Все профили: CSP violations отправляются на единый `csp-report-collector` endpoint (`apps/api/`-level), пишутся в `audit_log` + alerting в Sentry на pattern-spikes.
- Admin zone: дополнительно `Permissions-Policy: geolocation=(), microphone=(), camera=()` (lock down browser API surface).

**Authoritative implementation reference:** frontend design spec §3.2 + §3.2.2 (новая под-секция); конкретные CSP directives могут эволюционировать без amendment этой ADR (operational change), но изменение профилей-зон или релакс-уровней — требует нового amendment.

**Closes:** B5 + B7 из DSO-61 consistency report.

### A2 (2026-05-18, DSO-63 #2) — Host-only sessions + OIDC silent re-auth

Amendment отменяет A1.1 и фиксирует архитектурно-правильную модель cross-app SSO по результатам внешней валидации (DSO-63).

#### Контекст

Внешний ревьюер (Claude) в High-severity finding #2 указал, что shared `__Secure-ds_session` cookie на `.doctor.school` несовместима с принципами zero-trust между trust-zone границами:

> «Cross-subdomain `__Secure-ds_session` is an accepted downgrade. XSS or subdomain takeover anywhere under `.doctor.school` can threaten the shared session.»

После анализа стало очевидно, что:

- UX-обоснование A1.1 («непрерывность login state между portal и promo») решается стандартным OIDC SSO (silent re-auth `prompt=none`), без shared cookie.
- Mitigations A1.1 (fingerprint binding, CSRF double-submit, short TTL) не закрывают корневую угрозу — same-origin XSS использует браузер жертвы (fingerprint совпадает) и читает cookie напрямую.
- Архитектура уже имеет two-tier JWT + IdP (§1, §6) — base для OIDC silent re-auth уже есть.

#### Решение

**Каждое приложение держит свою host-only session cookie:**

- `portal.doctor.school` — собственная `__Host-` cookie, scoped только на portal.
- `admin.doctor.school` — собственная `__Host-` cookie.
- `promo.doctor.school` / корень `doctor.school` — собственная `__Host-` cookie (если требуется аутентифицированное состояние для лид-форм).
- `docs.doctor.school`, `cms.doctor.school` — собственные `__Host-` cookies.
- IdP (`auth.doctor.school`) — собственная host-only сессия (отдельная DB у IdP, см. ADR-0002 §3).

**Cross-app login continuity достигается через OIDC silent re-auth:**

- При заходе пользователя на subdomain X (где у него ещё нет валидной сессии), приложение X делает silent redirect → IdP с `prompt=none`.
- Если у пользователя есть активная сессия в IdP (cookie на `auth.doctor.school` host-only) — IdP моментально issues authorization code → приложение X обменивает на свой app-specific session token.
- Если нет активной IdP-сессии — нормальный login flow.
- UX: пользователь видит мгновенный transparent redirect (≤300ms), без явного логина.

**Обязательные технические требования к IdP** (для DSO-25 spike):

- Поддержка `prompt=none` (silent re-auth).
- Multiple `redirect_uri` allowed per OAuth client (или multiple clients, по одному на subdomain).
- Cookie configured как host-only (не SameSite=None cross-site).

**Authentik / Zitadel / Keycloak** — все три поддерживают эти требования. Amendment A2 не сужает IdP shortlist.

#### Session security profile (consolidated — single source of truth)

Все правила про cookie-based session живут **здесь, в §6 + Amendment A2**. Frontend / mobile / API specs ссылаются на ADR-0001 §6 forward-reference, не дублируют:

- **Prefix:** `__Host-` обязательно. `Domain` атрибут не используется. `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax` (минимум; `Strict` для admin/cms).
- **TTL:** соответствует refresh-token web TTL §6 (30d web, 14d mobile).
- **Rotation:** опираясь на refresh-token rotation (RFC 9700), §6.
- **CSRF protection:** double-submit pattern (cookie + header) на всех state-changing endpoints API.
- **Fingerprint binding:** UA + IP /24 + accept-language hash в session metadata; mismatch → re-auth via IdP.
- **Force-logout:** session-store DELETE → автоматически инвалидирует cookie на ближайшем запросе.

#### Frontend / mobile alignment

- **frontend-stack-design §3.2.1** — переписан под model «host-only per app + OIDC silent re-auth». Содержит UX flow для silent redirect.
- **identity-auth-rbac-design §3.2** — добавляет под-секцию «Cross-app SSO via OIDC silent re-auth» с диаграммой flow.
- **mobile-stack-design** — без изменений (mobile уже использует token-based auth + Keychain/Keystore, не cookie).

#### Закрывает

- DSO-63 finding #2 (cross-subdomain `__Secure-ds_session`).
- DSO-63 finding #3 (cookie security profile split между ADR-0001 §6 и frontend-design §3.2.1 — теперь single source of truth в ADR-0001 §6).
- DSO-63 mini-F (domain naming normalization — все субдомены работают как config constants).

### A4 — Step-up authentication для high-risk actions

**Status:** Принят (2026-05-18, DSO-63 follow-up / DSO-67).

#### Контекст

Базовая session, выданная после первичного login (§6 + Amendment A2), несёт общий security level, единый для read- и write-операций любого назначения. Для действий повышенного риска — деструктивных admin-операций над пользователями (role grant/revoke, lock, erasure-execute), account-level deletion / erasure-request от subject'а, payment-method change, изменения MFA, инициирования PII export, logout-all — общего level недостаточно: атакующий с украденной long-lived session не должен иметь возможности немедленно выполнить катастрофическое действие без свежей re-аутентификации.

#### Решение

Список endpoint-классов, требующих step-up — нормативно зафиксирован в **endpoint-authorization-matrix-design §8.1** (`auth: 'step-up'` декларация в `@Authz`). Триггер step-up — OIDC `prompt=login` + `acr_values=urn:ds:acr:mfa-fresh` на IdP. После успешного step-up IdP issues access-token с дополнительным claim `acr=mfa-fresh` и `mfa_fresh_at` timestamp; TTL свежего step-up — **30 минут** (см. identity-auth-rbac-design §7.1).

Backend обязан проверять `acr=mfa-fresh` AND `mfa_fresh_at ≥ now − 30 мин` на всех endpoints с `auth: 'step-up'` через единый `StepUpGuard` middleware (см. endpoint-authorization-matrix-design §8.2 + backend-core middleware checklist). При неуспехе — `401 Unauthorized` с телом `{ error: 'step_up_required', step_up_url: '<IdP authorize URL с prompt=login + acr_values + redirect_uri + state>' }`. Этот контракт ошибки — нормативный (endpoint-authz-matrix-design §8.2), frontend и mobile обязаны его обрабатывать.

#### Session lifetime после step-up

Elevated state — это **отдельный claim в access-token**, не отдельная session. Базовая session (refresh-token web 30d / mobile 14d, §6) продолжает существовать независимо: elevated TTL 30 мин истекает быстрее access-token TTL (15 мин), но обновление access-token через refresh-token не возвращает `acr=mfa-fresh` автоматически — после истечения elevated окна следующий high-risk action заново требует step-up. Step-up не продлевает базовую session expiration.

#### IdP requirements

`prompt=login` + custom `acr_values` поддерживают **Authentik, Zitadel и Keycloak** — все три кандидата из §8. Amendment A4 не сужает IdP shortlist; требование добавляется в чек-лист Phase 0 spike (DSO-25).

#### UX implications

Frontend (portal/admin/cms) обязан перехватывать `401 step_up_required`, выполнять redirect на `step_up_url` без потери текущего context (preserved через `state` параметр + client-side route restoration после возврата с auth code), обменивать code на обновлённый access-token, и retry оригинального request. Mobile — тот же flow через `ASWebAuthenticationSession` (iOS) / `Custom Tabs` (Android). Серия step-up-операций в пределах 30-минутного окна не требует повторной аутентификации (UX-критично для admin-консоли).

#### Audit

Каждая step-up попытка (success + fail) обязана писаться в `audit_ledger` (ADR-0003 §6, ADR-0009 §2.4 — audit class `auth.step_up.{requested,succeeded,failed}`) с полями `user_id`, `endpoint`, `acr_before`, `acr_after`, `mfa_method`, `ip`, `ua`. Полный список auth audit-событий — identity-auth-rbac-design §7.3.

#### Forward references

- **endpoint-authorization-matrix-design §8** — step-up policy, список endpoints, механика 401-ответа, `StepUpGuard` checklist.
- **backend-core-design** — middleware-stack для `auth: 'step-up'` (CI rule на наличие `StepUpGuard` для каждого endpoint с `auth: 'step-up'` декларацией).
- **identity-auth-rbac-design §7.1** — `acr=mfa-fresh` claim, TTL, MFA-elevated session.
- **ADR-0009 §2.4** — audit class регистрация для step-up событий.

#### Закрывает

- DSO-63 follow-up / DSO-67 — нормативная фиксация step-up auth на уровне ADR (ранее жил только в design specs).

### A3 (2026-05-18, DSO-63 #5+#6) — PD lifecycle moved to ADR-0009

PD lifecycle, consent management, retention, right-to-erasure — ранее размазанные по §134-141 этого ADR + engineering-readiness §5 + data-layer-design §2.5 — теперь архитектурно консолидированы в **ADR-0009 «PD Lifecycle, Consent, Retention, Erasure»** + связанном design spec.

**Forward-references:** consent capture flow при first-login (см. §9 hard cutover) использует consent_versions v1 из ADR-0009 §2.1. Right-to-erasure endpoints под `/me/*` — из ADR-0009 §2.2. Audit-log tombstoning compatibility — ADR-0009 §2.4.

**Закрывает:** DSO-63 finding #5 (отдельный ADR для PD lifecycle), #6 (retention matrix).
