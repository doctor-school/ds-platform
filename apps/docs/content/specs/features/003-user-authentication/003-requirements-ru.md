---
title: "003 — Аутентификация пользователя (net-new web → doctor_guest)"
description: "Требования: самостоятельная веб-аутентификация для портала врача — регистрация, верификация email/телефона, вход по паролю и беспарольно (email-OTP / SMS-OTP), BFF-сессия поверх __Host- cookie, ротация токенов, выход и сброс пароля. Создаёт backend-зеркало doctor_guest поверх Zitadel как IdP. Первая продуктовая feature-спека."
slug: 003-user-authentication
status: In dev
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/3
parent_issue: https://github.com/doctor-school/ds-platform/issues/80
issues: [81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 131]
prior_decisions:
  - ADR-0001 — Identity / Auth / RBAC (IdP = Zitadel; §1 hybrid RBAC, §3 dual identifiers, §4 auth methods, §6 tokens, §7 security baseline, §7.3 audit)
  - ADR-0002 — Backend Core Stack (§3 nestjs-zod + URI versioning + Vitest)
  - ADR-0003 — Data Layer (§5 idempotency_keys, §6 audit_ledger)
  - ADR-0009 — PD lifecycle & consent (per-purpose versioned consent capture)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS)
lang: ru
---

> **RU (это)** · **EN:** [`003-requirements-en.md`](./003-requirements-en.md)

# 003 — Аутентификация пользователя (Требования)

## Outcomes (результаты)

- Новый посетитель может самостоятельно зарегистрироваться на портале врача и получить backend-идентичность в роли `doctor_guest` (ADR-0001 §1), аутентифицированную против **Zitadel как IdP** (ADR-0001 §8).
- Credentials, сессии, токены, доставка OTP и хранение паролей **принадлежат Zitadel** и используются через его Session / User v2 API — `apps/api` никогда не переписывает auth-примитив (см. Constraints и design §2).
- Портал показывает **headless inline-формы на собственном origin** (ADR-0001 §2 — Вариант B; без редиректа на IdP-hosted приложение логина). Браузер держит только `__Host-` session-cookie; access/refresh-токены никогда не попадают в client-side JS (паттерн BFF, design §3).
- Каждый аутентифицированный принципал, который создаёт эта фича, — строка-зеркало `doctor_guest` в backend (`users`), с UUID-ключом. **Email — основной идентификатор регистрации** (у каждого регистранта есть email); телефон — вторичный идентификатор, добавляемый/верифицируемый после регистрации. Поэтому инвариант зеркала `phone OR email NOT NULL` (ADR-0001 §3) всегда выполняется через колонку email. Обоснование: Zitadel не может создать пригодного для входа human-пользователя без email — ограничение инвариантно для `AddHumanUser` v1/v2 и нового `CreateUser` `/v2/users/new` (подтверждено в `main`, proto `email … [(validate.rules).message.required = true]`), поэтому регистрация только по телефону на этом IdP нереализуема (GH #202).
- На регистрации **захватывается per-purpose версионированное согласие** до создания любой строки персональных данных (ПД) (ADR-0009).
- Обязательный **security baseline** v1 (ADR-0001 §7) — rate limiting, account lockout, защита от enumeration, SMS toll-fraud circuit-breaker, CAPTCHA — применяется на auth-поверхности.

## Scope (объём)

**Входит:**

- Самостоятельная регистрация на портале по **email + password** (email — основной идентификатор регистрации: Zitadel жёстко требует email при создании human-пользователя, GH #202).
- **Верификация email** (Zitadel email OTP-код) на регистрации. Верификация телефона — пост-регистрационная задача для вторичного идентификатора (будущее), не шаг регистрации.
- **Вход по паролю** по email или телефону (телефон — валидный идентификатор входа после того, как он привязан к аккаунту).
- **Беспарольный вход по email через OTP-код** (Zitadel `otp_email`; пользователь вводит код — _не_ magic-link, см. «Не входит»).
- **Вход по телефону через SMS-OTP** (Zitadel `otp_sms`).
- **Установка BFF-сессии**: `apps/api` завершает OIDC-обмен против Zitadel-сессии, хранит ротируемый refresh-токен серверно в Redis и ставит per-origin `__Host-` session-cookie (ADR-0001 §6).
- **Refresh / ротация токена** (opaque, single-use; reuse refresh инвалидирует цепочку — ADR-0001 §6, §7).
- **Выход** (серверный DELETE сессии → cookie очищается).
- **Сброс пароля** (Zitadel forgot-password code flow): инициация + завершение.
- **Backend user-mirror** пользователя `doctor_guest`, создаётся/обновляется по Zitadel Action-webhook, с минимальной reconciliation-сверкой.
- **Захват согласия** на регистрации через механизм ADR-0009 (фиксирует per-purpose версии согласия, принятые регистрантом).
- **Security baseline** (ADR-0001 §7): rate limits (per-user / per-IP / per-ASN), account lockout (нативная Zitadel lockout policy + наше письмо-уведомление), enumeration-устойчивые ответы, SMS toll-fraud per-phone/IP/ASN лимиты + глобальный дневной SMS-budget circuit-breaker.
- **Бутстрап bot-protection.** 003 — первый на платформе потребитель bot-protection, поэтому бутстрапит механизм за провайдер-интерфейсом `BotProtection` — адаптер Yandex SmartCaptcha (серверная верификация токена в `apps/api`) + виджет на auth-формах портала. Провайдер остаётся сменяемым по ADR-0001 open-q #7; 003 владеет политикой того, _где_ он применяется (EARS-17).
- **Auth audit-события** в `audit_ledger` (этот раздел и есть «spec §7.3», на который ссылается ADR-0001 §7, §10).

**Явно не входит** (каждое — задокументированный шов для более поздней вертикали — design §7):

- **Реактивация legacy-врачей** (~10k Directual hard cutover, hash-compat vs forced reset, first-login). Остаётся операционным артефактом + отдельной спекой по ADR-0001 §9. 003 лишь экспонирует примитивы, которые она переиспользует (email-OTP, SMS-OTP, consent capture, mirror sync).
- **MFA enrollment / enforcement.** У `doctor_guest` нет мандата на MFA (ADR-0001 §4). 003 поставляет claim `mfa` в сессии (ADR-0001 §1) и задокументированный шов-политику `role → mfa_required`, но **не** строит TOTP enrollment/verification и заполняет политику **без** элевейтед-ролей. Первая вертикаль с mandatory-MFA-ролью (admin/ops → `platform_admin`; v2 `expert` и т.д.) строит механизм.
- **Magic-link** (кликабельный URL логина). Для v1 заменён нативным email-OTP. Тонкий транспорт поверх нативного one-time-секрета + security-review по ADR-0001 §8 остаётся швом.
- **Аутентификация `platform_admin` / `legacy_admin`.** Это провижинимые/ops-принципалы (вертикаль admin-консоли) или cutover-owned (ADR-0001 §9), а не выход саморегистрации.
- **Mobile-аутентификация** (device-id-bound refresh, Keychain/Keystore, biometric unlock, нативный OAuth-hop — ADR-0001 §6, ADR-0005). Отдельная итерация поверх тех же backend-примитивов.
- **Social OAuth** (VK ID / Yandex ID / Telegram) — v2 по ADR-0001 §5; **account linking** — ADR-0001 §6.2.
- **Step-up аутентификация** для high-risk действий (ADR-0001 §10) — high-risk эндпоинтов `doctor_guest` ещё нет.
- Полный **consent-сабсистем** (withdrawal, миграция версий, аудит согласия) — принадлежит вертикали ADR-0009; 003 только захватывает на регистрации.
- WebAuthn / Passkeys, проверка HIBP pwned-password, anomaly/impossible-travel detection — отложены по таблице deferred-gaps ADR-0001.

## Constraints (ограничения)

- **Граница IdP (жёсткая).** Проверка credentials, жизненный цикл сессии, выпуск/ротация токенов, JWKS/OIDC, доставка OTP (email + SMS), хранение паролей и подсчёт account-lockout — **нативные функции Zitadel** — используются через Session / User v2 API, никогда не переписываются в `apps/api`. Разбивка native-vs-custom зафиксирована в design §2 (таблица). Действует дисциплина AGPL §13: интеграция только через API/Actions/config; **не патчить исходники Zitadel** (ADR-0001 §8).
- **UI-модель = Вариант B (headless inline).** Формы живут на origin портала; BFF брокерит вызовы Zitadel. Без IdP-hosted приложения логина, без редиректа на auth-сабдомен для credentials (ADR-0001 §2). Zitadel Login v2 рассмотрен и отклонён для v1 (design §8 — записано, чтобы не релитигировать).
- **Никакого хардкода origin.** Origin портала / домен cookie читаются из конфигурации, не хардкодятся в коде или спеке (зеркалит AGENTS.md §9.1). `__Host-` cookie origin-bound по построению.
- **Токены** (ADR-0001 §6): access JWT 15 мин (RS256/ES256); refresh opaque, ротируемый, single-use, 30 дней web; refresh хранится серверно в Redis на BFF; `__Host-` cookie HttpOnly + Secure + SameSite=Lax, per-app origin (без shared cookie между сабдоменами). JWT-claims минимальны: `sub, roles[], mfa, sid, iat, exp, jti` — без `permissions[]`.
- **Идентификаторы** (ADR-0001 §3): UUID — единственный FK-ключ; `phone` и `email` оба уникальны, оба — методы входа; CHECK `phone OR email NOT NULL`.
- **Согласие до ПД** (ADR-0009): ни одна несущая ПД строка `users` не коммитится до записи per-purpose версий согласия регистранта.
- **Запиненная версия Zitadel.** Развёрнутый Zitadel должен быть релизом с патчами против известных обходов login-UI enumeration — CVE-2024-41952 (флаг «ignore unknown usernames» не соблюдался), CVE-2025-57770 (страница «select account») и CVE-2026-23511 (endpoints password-reset + Login UI V2) — т.е. **≥ 4.9.1 (v4) или ≥ 3.4.6 (v3)**. Пин патченой версии — часть Definition of Done; наши rate-limit + enumeration-устойчивые ответы — backstop в глубину (ADR-0001 §7).
- **Стек** (ADR-0002): Node 22 LTS, TS strict, ESM-only; NestJS 11 + Fastify + `nestjs-zod`; SSOT схем в `packages/schemas/`; URI-версионирование `/v1/...`; Vitest + supertest. Сервис-зависимые тесты `skipIf` отсутствия их env-зависимости (`DATABASE_URL`, `IDP_ISSUER`), чтобы не краснить `main` в общем CI unit-джобе.
- **Аудит** (ADR-0003 §6): auth-события дописываются в `audit_ledger` (append-only, хранение 3 года); ПД в логах маскируется.

## Prior decisions (предшествующие решения)

- **ADR-0001** Identity / Auth / RBAC — IdP = Zitadel (§8); hybrid RBAC с грубыми ролями v1 вкл. `doctor_guest` (§1); headless UI credentials (§2); dual identifiers + UUID PK (§3); методы auth v1 email+password / email-magic-link / phone-SMS-OTP (§4 — magic-link реализован здесь как нативный email-OTP, design §8); token-модель OAuth 2.0 BCP (§6); обязательный security baseline v1 (§7); auth audit-события (§7.3, авторизуются здесь); Directual cutover (§9, вне объёма); step-up (§10, вне объёма).
- **ADR-0002 §3** Backend Core Stack — `nestjs-zod`, URI-версионирование, Vitest + supertest, SSOT `packages/schemas/`.
- **ADR-0003 §5/§6** Data Layer — `idempotency_keys` для идемпотентного реплея команд; `audit_ledger` для auth audit-трейла.
- **ADR-0009** PD lifecycle & consent — per-purpose версионированное согласие; механизм захвата используется на регистрации.
- **ADR-0006 §4** Documentation & SSOT — структура feature-spec триплета + flat-нумерация EARS.

## Event Model

Auth-вертикаль — первый реальный кластер агрегатов платформы (в отличие от query-only 001/002). Владение разделено через границу IdP: **Zitadel** владеет состоянием credentials/сессий/токенов; **`apps/api`** владеет доменным зеркалом, согласием, грантом RBAC-роли, аудитом и guard'ами против злоупотреблений.

### Commands (обрабатывает `apps/api` BFF, делегируя credential-работу Zitadel)

`RegisterWithEmailPassword` · `RegisterWithPhonePassword` · `VerifyEmail` · `VerifyPhone` · `LoginWithPassword` · `RequestEmailOtp` · `LoginWithEmailOtp` · `RequestSmsOtp` · `LoginWithSmsOtp` · `RefreshSession` · `Logout` · `RequestPasswordReset` · `CompletePasswordReset`

### Events

| Событие                                                      | Владелец                               | Заметки                                                     |
| ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `UserRegistered`                                             | Zitadel → mirror                       | Триггерит политику регистрации ниже.                        |
| `ConsentCaptured`                                            | `apps/api`                             | Per-purpose версии фиксируются до активации строки-зеркала. |
| `MirrorSynced`                                               | `apps/api`                             | Строка `doctor_guest` upsert по Zitadel Action-webhook.     |
| `EmailVerified` / `PhoneVerified`                            | Zitadel → mirror                       | Состояние верификации зеркалится.                           |
| `SessionEstablished` / `SessionRefreshed` / `SessionRevoked` | `apps/api` (поверх Zitadel-сессии)     | Cookie set / rotated / cleared.                             |
| `PasswordResetRequested` / `PasswordResetCompleted`          | Zitadel → audit                        |                                                             |
| `AccountLocked`                                              | Zitadel (policy) → `apps/api` (notify) | Достигнут lockout → письмо-уведомление.                     |
| `RefreshReuseDetected`                                       | `apps/api`                             | Нарушение single-use → инвалидация цепочки.                 |

### Read models

- **`UserMirror`** — backend-строка `users`: `id` (UUID PK), `zitadel_sub`, `email?`, `phone?`, `email_verified`, `phone_verified`, `role = doctor_guest`, timestamps. Инвариант `phone OR email NOT NULL`.
- **`ActiveSession`** — BFF-сессия в Redis: `sid`, `zitadel_session_id`, refresh-токен (opaque), fingerprint, привязка `__Host-` cookie.

### Policies

- **На `UserRegistered`** → записать `ConsentCaptured`, выдать `doctor_guest`, upsert `UserMirror` (`MirrorSynced`). Активация ПД заблокирована до согласия.
- **На порог failed-login (Zitadel lockout policy)** → `AccountLocked` → письмо-уведомление (`apps/api`).
- **На `RefreshReuseDetected`** → отозвать всю refresh-цепочку (RFC 6819) + аудит.

## EARS requirements

> **Конвенция нумерации:** плоская (`EARS-1`, `EARS-2`, …) по ADR-0006 §4. EARS-1…12 — функциональные хендлеры (каждый становится дочерним Issue); EARS-13…22 — сквозные ubiquitous / unwanted-behavior требования, применяемые по всей поверхности. CI-гард `ears-tests` — content-match WARN в Phase 0.

**Регистрация и верификация**

- **EARS-1:** Когда посетитель отправляет форму регистрации с валидным email и политике-конформным паролем, система должна создать пользователя Zitadel, записать принятые per-purpose версии согласия (ADR-0009), сделать upsert строки `doctor_guest` `UserMirror`, запустить email-код верификации и ответить, не раскрывая, существовал ли email ранее (enumeration-устойчиво, EARS-16).
- **EARS-2:** Email — **основной идентификатор регистрации** (см. EARS-1); телефон — **пост-регистрационный вторичный идентификатор** (добавляется/верифицируется после создания аккаунта), а **не** канал регистрации. Регистрации только по телефону нет — Zitadel не может создать пригодного для входа human без email (инвариантно для `AddHumanUser` v1/v2 и `CreateUser` `/v2/users/new`, подтверждено в `main`; GH #202). Телефон как идентификатор _входа_ (EARS-5) и SMS-OTP-вход (EARS-7) не затронуты — они работают с уже привязанным верифицированным телефоном. (Поверхность пост-регистрационной «привязки + верификации вторичного телефона» — будущий инкремент, здесь не строится.)
- **EARS-3:** Когда регистрант отправляет email-код верификации, система должна проверить его через Zitadel `otp_email`, выставить `email_verified` в зеркале и записать одну терминальную строку `auth.account.verified` (канал `email`) в `audit_ledger`; невалидный/истёкший код возвращает обобщённую ошибку, не пишет терминальную строку и засчитывается в лимит попыток OTP.
- **EARS-4:** Верификация при регистрации — **только email** (EARS-3). Верификация телефона (`phone_verified` через Zitadel `otp_sms`) — пост-регистрационная задача для вторичного идентификатора (будущее), не шаг регистрации: на регистрации телефона для верификации нет, потому что регистрация email-первична (EARS-2). Порт/хендлер verify по-прежнему различает каналы ради будущего пути вторичного телефона; путь _входного_ SMS-OTP-кода (EARS-7) не затронут.

**Вход**

- **EARS-5:** Когда пользователь отправляет идентификатор (email или телефон) + пароль, система должна создать Zitadel-сессию с проверкой пароля; при успехе установить BFF-сессию (EARS-8); при неудаче вернуть enumeration-устойчивую обобщённую ошибку и инкрементировать счётчик lockout.
- **EARS-6:** Когда пользователь запрашивает email-код входа и затем отправляет его, система должна проверить его через Zitadel `otp_email` и при успехе установить BFF-сессию (EARS-8). (Это беспарольный email-путь v1; без magic-link.)
- **EARS-7:** Когда пользователь запрашивает SMS-код входа и затем отправляет его, система должна проверить его через Zitadel `otp_sms` и при успехе установить BFF-сессию (EARS-8), с учётом guard'а SMS toll-fraud (EARS-14).
- **EARS-8:** Когда Zitadel-сессия прошла требуемую проверку, система должна завершить OIDC-обмен, сохранить ротируемый refresh-токен серверно в Redis, выпустить access JWT (claims `sub, roles[], mfa, sid, iat, exp, jti`) и поставить per-origin `__Host-` HttpOnly+Secure+SameSite=Lax session-cookie; браузер никогда не должен получать токен в теле ответа.

**Сессия**

- **EARS-9:** Когда клиент предъявляет валидный session-cookie, у которого истёк access-токен, система должна ротировать refresh-токен single-use и выпустить новый access-токен; если refresh-токен реплеится после ротации, система должна инвалидировать всю цепочку, отозвать сессию и записать `RefreshReuseDetected` (ADR-0001 §6/§7, RFC 6819).
- **EARS-10:** Когда аутентифицированный пользователь запрашивает выход, система должна сделать DELETE серверной сессии (инвалидируя её refresh-цепочку), очистить `__Host-` cookie и записать `SessionRevoked`.

**Сброс пароля**

- **EARS-11:** Когда пользователь запрашивает сброс пароля для идентификатора, система должна запустить Zitadel forgot-password code flow и ответить enumeration-устойчиво независимо от существования идентификатора (ADR-0001 §7; backstop к Zitadel reset-flow enumeration advisory).
- **EARS-12:** Когда пользователь отправляет валидный reset-код и политике-конформный новый пароль, система должна установить новый пароль через Zitadel, отозвать все существующие сессии этого пользователя и записать `PasswordResetCompleted`.

**Сквозные (ubiquitous / unwanted-behavior)**

- **EARS-13:** Система должна rate-лимитировать auth-эндпоинты по ADR-0001 §7 — per-user (5 / 15 мин), per-IP (20 / 15 мин), per-ASN (100 / ч) — возвращая обобщённый throttled-ответ без раскрытия существования аккаунта.
- **EARS-14:** Во время отправки SMS (верификация или login OTP) система должна применять per-phone (3/ч), per-IP (10/ч), per-ASN (100/ч) лимиты и глобальный дневной SMS-budget circuit-breaker (≤ 2000/день), отказывая в дальнейших отправках при превышении любого порога.
- **EARS-15:** Когда пользователь достигает 10 неудачных попыток пароля за 30 мин, система должна soft-залочить аккаунт (нативная Zitadel lockout policy) и отправить письмо-уведомление; аккаунт разблокируется по политике.
- **EARS-16:** Система должна возвращать идемпотентные, enumeration-устойчивые ответы на register / login / reset с timing-дельтой ≤ 50 мс между путём существующего и неизвестного аккаунта (ADR-0001 §7).
- **EARS-17:** Когда запрос исходит с неаутентифицированной abuse-prone поверхности (регистрация, сброс пароля или вход после N неудач), система должна потребовать валидный bot-protection-токен — проверяемый через провайдер-интерфейс `BotProtection` (адаптер v1 — Yandex SmartCaptcha) — до обработки.
- **EARS-18:** Система должна дописывать каждое auth-событие — `auth.{register, account.verified, login.succeeded, login.failed, logout, token.refresh, token.reuse_detected, password.reset.requested, password.reset.completed, otp.sent, otp.verified, otp.failed, lockout, consent.captured}` — в `audit_ledger` (ADR-0003 §6) с маскированием ПД.
- **EARS-19:** Когда Zitadel эмитит Action-webhook создания/обновления пользователя, система должна сделать upsert соответствующей строки `UserMirror`, обеспечить грант роли `doctor_guest` и сверять расхождения периодической свёрткой (eventual consistency, ADR-0001 Consequences).
- **EARS-20:** Когда обрабатывается регистрация, система должна записать принятые регистрантом per-purpose версии согласия (ADR-0009) и должна отказать в активации несущей ПД строки-зеркала, если согласие отсутствует.
- **EARS-21:** Интерфейс аутентификации портала должен отображаться на **русском языке (основной)** и **не должен содержать захардкоженных пользовательских строк** — вся копия (подписи, описания, кнопки, плейсхолдеры, строка согласия и сообщения об ошибках) берётся из типизированного каталога сообщений поверх i18n-готовой структуры, так что будущую локаль можно добавить без правки компонентов; **сейчас выпускается только RU без пользовательского переключателя языка** (инфраструктура i18n присутствует для будущей локали). (Дизайн §8.1.)
- **EARS-22:** Каждое поле пользовательского ввода портала должно применять релевантное его типу данных правило клиентской валидации и input-маску — форма email, телефон E.164 с маской, фиксированной длины числовой OTP, политика пароля — до отправки, показывая очевидно-некорректный ввод локализованной (RU) копией из каталога сообщений (EARS-21); это лишь UX-affordance — BFF/IdP остаётся credential authority (Constraints), а request-схемы остаются нестрогими, поэтому поле, для которого релевантного правила нет, указывает «none» с однострочным обоснованием. (Дефекты #192 (идентификатор `/login`) и #196 (идентификатор `/reset`) мотивируют это; enforcement — семантические field-примитивы + ESLint-гейт — отслеживается в #197. Дизайн §8.2.)

## Invariants (инварианты)

- Каждая строка `UserMirror` удовлетворяет `phone OR email NOT NULL` и несёт ровно один `zitadel_sub`. Поскольку регистрация email-первична (EARS-1/2; Zitadel жёстко требует email, GH #202), каждая зарегистрированная строка несёт email, поэтому инвариант всегда выполняется через колонку email; телефон — опциональный вторичный идентификатор.
- Ни одна несущая ПД строка `users` не коммитится без соответствующей записи `ConsentCaptured` (EARS-20).
- Refresh-токен валиден ровно для одной ротации; любой reuse инвалидирует цепочку (EARS-9).
- Ни access-, ни refresh-токен никогда не появляется в читаемом клиентом теле ответа или в не-`__Host-` хранилище (EARS-8).
- Ответы register / login / reset неразличимы (status + body + timing ≤ 50 мс) между существующим и неизвестным идентификатором (EARS-16).
- Каждая изменяющая состояние auth-команда эмитит ровно одну терминальную запись `audit_ledger` (EARS-18).
- `apps/api` не содержит хеширования паролей, подписи токенов и генерации OTP — всё делегировано Zitadel (Constraints, design §2).
- Session JWT несёт claim `mfa`, даже если ни один поток `doctor_guest` не требует MFA (шов для будущего enforcement).

## Verification (верификация)

| EARS  | Тип теста               | Файл (ориентировочно)                           | Заметки                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| 1–2   | Vitest e2e              | `apps/api/test/auth/register.e2e-spec.ts`       | `it('EARS-1: ...')` email-первичная регистрация; проверяет создание пользователя Zitadel, строку-зеркало `doctor_guest`, запись согласия, запуск email-верификации, enumeration-safe ответ. EARS-2: регистрации только по телефону нет (Zitadel жёстко требует email, GH #202) — набор проверяет, что попытка регистрации только по телефону — обработанный enumeration-safe сбой, **никогда не 500** (robustness-фикс + паритет fake/real). `skipIf(!IDP_ISSUER |     | !DATABASE_URL)`. |
| 3–4   | Vitest e2e              | `apps/api/test/auth/verify.e2e-spec.ts`         | EARS-3 email-верификация: валидный + невалидный/истёкший код; флаг `email_verified` переключается. EARS-4: верификация при регистрации — только email; верификация телефона — будущий пост-регистрационный путь вторичного идентификатора (GH #202).                                                                                                                                                                                                             |
| 5     | Vitest e2e              | `apps/api/test/auth/login-password.e2e-spec.ts` | Успех → cookie set; неверный пароль → обобщённая ошибка + counter++.                                                                                                                                                                                                                                                                                                                                                                                             |
| 6–7   | Vitest e2e              | `apps/api/test/auth/login-otp.e2e-spec.ts`      | Email-OTP + SMS-OTP вход; SMS-путь проверяет взаимодействие с toll-fraud guard (EARS-14).                                                                                                                                                                                                                                                                                                                                                                        |
| 8     | Vitest e2e              | `apps/api/test/auth/session.e2e-spec.ts`        | Проверяет атрибуты `__Host-` cookie, отсутствие токена в теле, набор JWT-claims.                                                                                                                                                                                                                                                                                                                                                                                 |
| 9     | Vitest e2e + unit       | `apps/api/test/auth/refresh.e2e-spec.ts`        | Happy-path ротации; reuse → инвалидация цепочки + `RefreshReuseDetected`.                                                                                                                                                                                                                                                                                                                                                                                        |
| 10    | Vitest e2e              | `apps/api/test/auth/logout.e2e-spec.ts`         | DELETE сессии + очистка cookie.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 11–12 | Vitest e2e              | `apps/api/test/auth/password-reset.e2e-spec.ts` | Enumeration-safe инициация; завершение отзывает сессии.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 13,16 | Vitest e2e + unit       | `apps/api/test/auth/abuse-limits.e2e-spec.ts`   | Пороги rate-limit; assertion timing-дельты для enumeration.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 14    | Vitest unit             | `apps/api/src/auth/sms-budget.spec.ts`          | Счётчики per-phone/IP/ASN + дневной circuit-breaker (mock-часы + SMS-клиент).                                                                                                                                                                                                                                                                                                                                                                                    |
| 15    | Vitest e2e              | `apps/api/test/auth/lockout.e2e-spec.ts`        | 10 неудач → lock + письмо-уведомление (assertion через Mailpit в dev-stand).                                                                                                                                                                                                                                                                                                                                                                                     |
| 17    | Vitest unit             | `apps/api/src/auth/captcha.guard.spec.ts`       | Отсутствующий/невалидный SmartCaptcha-токен → отклонён.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18    | Vitest unit             | `apps/api/src/auth/audit.spec.ts`               | Каждая команда эмитит ровно одну запись `audit_ledger`; ПД маскируется.                                                                                                                                                                                                                                                                                                                                                                                          |
| 19    | Vitest e2e              | `apps/api/test/auth/mirror-sync.e2e-spec.ts`    | Upsert по webhook + грант роли; reconciliation-свёртка закрывает внедрённое расхождение.                                                                                                                                                                                                                                                                                                                                                                         |
| 20    | Vitest e2e              | `apps/api/test/auth/consent.e2e-spec.ts`        | Регистрация без согласия отклонена; с согласием → версии записаны.                                                                                                                                                                                                                                                                                                                                                                                               |
| all   | Gherkin (e2e) → browser | `003-scenarios.feature`                         | Happy-пути + failure-ветки, транслируются в Playwright через `playwright-bdd`. Это `user-facing`-спека, поэтому сквозной browser-прогон (регистрация→верификация→логин→выход в портале) — обязательный deliverable, **owned и tracked задачей #131 (F7: portal auth integration + E2E)**, а не сноской «вне объёма». F1–F5 поставили BFF-хендлеры; #131 подключает формы портала и приносит browser-E2E.                                                         |

## Dependencies & sequencing (зависимости и последовательность)

- **Frontend-scaffold (первый потребитель).** Auth-формы Варианта B живут в `apps/portal`, собираются из `packages/design-system` — **оба сейчас стабы** (только `package.json`). Frontend-часть 003 их graduate: скаффолдит `apps/portal` (Tailwind 4 + shadcn/ui, ADR-0004 §5–7) и graduate `packages/design-system` с design-токенами (CSS-переменные темы вкл. `--radius`) + только тем набором компонентов формы, что нужен (Input, Button, Form, Label, OTP-input, Card), по инкрементальному паттерну graduation стабов из 001/002. Секвенируется до form-facing EARS; полная DS дорастает с поздними вертикалями.
- **Endpoint-authorization matrix (ADR-0001 design §2.5 — «mandatory artifact» + CI-гейт `tools/lint-endpoint-authz`).** Эта инфра **ещё не существует** в `tools/`. 003 вводит первые реальные классифицированные эндпоинты (public: register / login / reset / verify; защищённые `doctor_guest`: logout / refresh / session). Поэтому 003 либо бутстрапит минимальную конвенцию метаданных endpoint-authz + линт, либо гейтится на предшествующей engineering-task, которая это делает. **Решение lead-агента до планирования дочерних Issue.**
- **Механизм согласия (ADR-0009).** EARS-20 нужен capture-API. Если capture-примитив ADR-0009 ещё не реализован, 003 строит минимальный захват на регистрации (записать принятые версии) и оставляет withdrawal/миграцию версий вертикали ADR-0009.
- **Dev-stand Zitadel + Mailpit + Redis.** Интеграционные тесты идут против dev-stand-сервисов `idp`, `mailpit` и Redis (AGENTS.md §9); эндпоинты/порты читаются из `.env.local`.
- **Decision-debt → ревизия ADR-0001 (отдельная adr-revision задача).** Три находки ресёрча касаются ADR-0001 и записаны в design §9 для follow-up ревизии — не изменяются внутри этого spec-authoring: §8 (формулировка magic-link с появлением нативного email-OTP), §7 (Zitadel enumeration/lockout CVE + пин патченой версии), §2 (Login v2 рассмотрен и отклонён).
