---
title: "003 — Аутентификация пользователя (net-new web → doctor_guest)"
description: "Требования: самостоятельная веб-аутентификация для портала врача — регистрация, верификация email/телефона, вход по паролю и беспарольно (email-OTP / SMS-OTP), BFF-сессия поверх __Host- cookie, ротация токенов, выход и сброс пароля. Создаёт backend-зеркало doctor_guest поверх Zitadel как IdP. Первая продуктовая feature-спека."
slug: 003-user-authentication
status: Draft
tracker: https://github.com/doctor-school/ds-platform/milestone/3 # placeholder — milestone «Auth foundations v1» ещё не создан
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
- Каждый аутентифицированный принципал, который создаёт эта фича, — строка-зеркало `doctor_guest` в backend (`users`), с UUID-ключом и инвариантом dual-identifier `phone OR email NOT NULL` (ADR-0001 §3), синхронизированная из Zitadel.
- На регистрации **захватывается per-purpose версионированное согласие** до создания любой строки персональных данных (ПД) (ADR-0009).
- Обязательный **security baseline** v1 (ADR-0001 §7) — rate limiting, account lockout, защита от enumeration, SMS toll-fraud circuit-breaker, CAPTCHA — применяется на auth-поверхности.

## Scope (объём)

**Входит:**

- Самостоятельная регистрация на портале по **email + password** и по **phone + password** (dual identifier, ADR-0001 §3).
- **Верификация email** (Zitadel email OTP-код) и **верификация телефона** (Zitadel SMS OTP-код).
- **Вход по паролю** по email или телефону.
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
- **Запиненная версия Zitadel.** Развёрнутый Zitadel должен быть релизом с патчами против известных enumeration / lockout-bypass advisory (напр. CVE-2025-57770 и обход «ignore unknown usernames» в reset-flow). Пин патченой версии — часть Definition of Done; наши rate-limit + enumeration-устойчивые ответы — backstop в глубину (ADR-0001 §7).
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

> **Конвенция нумерации:** плоская (`EARS-1`, `EARS-2`, …) по ADR-0006 §4. EARS-1…12 — функциональные хендлеры (каждый становится дочерним Issue); EARS-13…20 — сквозные ubiquitous / unwanted-behavior требования, применяемые по всей поверхности. CI-гард `ears-tests` — content-match WARN в Phase 0.

**Регистрация и верификация**

- **EARS-1:** Когда посетитель отправляет форму регистрации с валидным email и политике-конформным паролем, система должна создать пользователя Zitadel, записать принятые per-purpose версии согласия (ADR-0009), сделать upsert строки `doctor_guest` `UserMirror`, запустить email-код верификации и ответить, не раскрывая, существовал ли email ранее (enumeration-устойчиво, EARS-16).
- **EARS-2:** Когда посетитель отправляет форму регистрации с валидным телефоном и политике-конформным паролем, система должна создать пользователя Zitadel, записать согласие, сделать upsert строки `doctor_guest` `UserMirror`, запустить SMS-код верификации и ответить enumeration-устойчиво.
- **EARS-3:** Когда регистрант отправляет email-код верификации, система должна проверить его через Zitadel `otp_email`, выставить `email_verified` в зеркале и записать `EmailVerified` в `audit_ledger`; невалидный/истёкший код возвращает обобщённую ошибку и засчитывается в лимит попыток OTP.
- **EARS-4:** Когда регистрант отправляет SMS-код верификации, система должна проверить его через Zitadel `otp_sms`, выставить `phone_verified` и записать `PhoneVerified`; невалидные/истёкшие коды ведут себя как в EARS-3.

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
- **EARS-18:** Система должна дописывать каждое auth-событие — `auth.{register, login.succeeded, login.failed, logout, token.refresh, token.reuse_detected, password.reset.requested, password.reset.completed, otp.sent, otp.verified, otp.failed, lockout, consent.captured}` — в `audit_ledger` (ADR-0003 §6) с маскированием ПД.
- **EARS-19:** Когда Zitadel эмитит Action-webhook создания/обновления пользователя, система должна сделать upsert соответствующей строки `UserMirror`, обеспечить грант роли `doctor_guest` и сверять расхождения периодической свёрткой (eventual consistency, ADR-0001 Consequences).
- **EARS-20:** Когда обрабатывается регистрация, система должна записать принятые регистрантом per-purpose версии согласия (ADR-0009) и должна отказать в активации несущей ПД строки-зеркала, если согласие отсутствует.

## Invariants (инварианты)

- Каждая строка `UserMirror` удовлетворяет `phone OR email NOT NULL` и несёт ровно один `zitadel_sub`.
- Ни одна несущая ПД строка `users` не коммитится без соответствующей записи `ConsentCaptured` (EARS-20).
- Refresh-токен валиден ровно для одной ротации; любой reuse инвалидирует цепочку (EARS-9).
- Ни access-, ни refresh-токен никогда не появляется в читаемом клиентом теле ответа или в не-`__Host-` хранилище (EARS-8).
- Ответы register / login / reset неразличимы (status + body + timing ≤ 50 мс) между существующим и неизвестным идентификатором (EARS-16).
- Каждая изменяющая состояние auth-команда эмитит ровно одну терминальную запись `audit_ledger` (EARS-18).
- `apps/api` не содержит хеширования паролей, подписи токенов и генерации OTP — всё делегировано Zitadel (Constraints, design §2).
- Session JWT несёт claim `mfa`, даже если ни один поток `doctor_guest` не требует MFA (шов для будущего enforcement).

## Verification (верификация)

| EARS  | Тип теста         | Файл (ориентировочно)                           | Заметки                                                                                                                                                                                                                                  |
| ----- | ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| 1–2   | Vitest e2e        | `apps/api/test/auth/register.e2e-spec.ts`       | `it('EARS-1: ...')` / `it('EARS-2: ...')`; против dev-stand Zitadel + Postgres; проверяет создание пользователя Zitadel, строку-зеркало `doctor_guest`, запись согласия, запуск верификации, enumeration-safe ответ. `skipIf(!IDP_ISSUER |     | !DATABASE_URL)`. |
| 3–4   | Vitest e2e        | `apps/api/test/auth/verify.e2e-spec.ts`         | Валидный + невалидный/истёкший код; флаги `*_verified` зеркала переключаются.                                                                                                                                                            |
| 5     | Vitest e2e        | `apps/api/test/auth/login-password.e2e-spec.ts` | Успех → cookie set; неверный пароль → обобщённая ошибка + counter++.                                                                                                                                                                     |
| 6–7   | Vitest e2e        | `apps/api/test/auth/login-otp.e2e-spec.ts`      | Email-OTP + SMS-OTP вход; SMS-путь проверяет взаимодействие с toll-fraud guard (EARS-14).                                                                                                                                                |
| 8     | Vitest e2e        | `apps/api/test/auth/session.e2e-spec.ts`        | Проверяет атрибуты `__Host-` cookie, отсутствие токена в теле, набор JWT-claims.                                                                                                                                                         |
| 9     | Vitest e2e + unit | `apps/api/test/auth/refresh.e2e-spec.ts`        | Happy-path ротации; reuse → инвалидация цепочки + `RefreshReuseDetected`.                                                                                                                                                                |
| 10    | Vitest e2e        | `apps/api/test/auth/logout.e2e-spec.ts`         | DELETE сессии + очистка cookie.                                                                                                                                                                                                          |
| 11–12 | Vitest e2e        | `apps/api/test/auth/password-reset.e2e-spec.ts` | Enumeration-safe инициация; завершение отзывает сессии.                                                                                                                                                                                  |
| 13,16 | Vitest e2e + unit | `apps/api/test/auth/abuse-limits.e2e-spec.ts`   | Пороги rate-limit; assertion timing-дельты для enumeration.                                                                                                                                                                              |
| 14    | Vitest unit       | `apps/api/src/auth/sms-budget.spec.ts`          | Счётчики per-phone/IP/ASN + дневной circuit-breaker (mock-часы + SMS-клиент).                                                                                                                                                            |
| 15    | Vitest e2e        | `apps/api/test/auth/lockout.e2e-spec.ts`        | 10 неудач → lock + письмо-уведомление (assertion через Mailpit в dev-stand).                                                                                                                                                             |
| 17    | Vitest unit       | `apps/api/src/auth/captcha.guard.spec.ts`       | Отсутствующий/невалидный SmartCaptcha-токен → отклонён.                                                                                                                                                                                  |
| 18    | Vitest unit       | `apps/api/src/auth/audit.spec.ts`               | Каждая команда эмитит ровно одну запись `audit_ledger`; ПД маскируется.                                                                                                                                                                  |
| 19    | Vitest e2e        | `apps/api/test/auth/mirror-sync.e2e-spec.ts`    | Upsert по webhook + грант роли; reconciliation-свёртка закрывает внедрённое расхождение.                                                                                                                                                 |
| 20    | Vitest e2e        | `apps/api/test/auth/consent.e2e-spec.ts`        | Регистрация без согласия отклонена; с согласием → версии записаны.                                                                                                                                                                       |
| all   | Gherkin (e2e)     | `003-scenarios.feature`                         | Happy-пути + failure-ветки; транслируются в Playwright через `playwright-bdd`, когда появится этот раннер (вне объёма здесь).                                                                                                            |

## Dependencies & sequencing (зависимости и последовательность)

- **Endpoint-authorization matrix (ADR-0001 §2.5 — «mandatory artifact» + CI-гейт `tools/lint-endpoint-authz`).** Эта инфра **ещё не существует** в `tools/`. 003 вводит первые реальные классифицированные эндпоинты (public: register / login / reset / verify; защищённые `doctor_guest`: logout / refresh / session). Поэтому 003 либо бутстрапит минимальную конвенцию метаданных endpoint-authz + линт, либо гейтится на предшествующей engineering-task, которая это делает. **Решение lead-агента до планирования дочерних Issue.**
- **Механизм согласия (ADR-0009).** EARS-20 нужен capture-API. Если capture-примитив ADR-0009 ещё не реализован, 003 строит минимальный захват на регистрации (записать принятые версии) и оставляет withdrawal/миграцию версий вертикали ADR-0009.
- **Dev-stand Zitadel + Mailpit + Redis.** Интеграционные тесты идут против dev-stand-сервисов `idp`, `mailpit` и Redis (AGENTS.md §9); эндпоинты/порты читаются из `.env.local`.
- **Decision-debt → ревизия ADR-0001 (отдельная adr-revision задача).** Три находки ресёрча касаются ADR-0001 и записаны в design §9 для follow-up ревизии — не изменяются внутри этого spec-authoring: §8 (формулировка magic-link с появлением нативного email-OTP), §7 (Zitadel enumeration/lockout CVE + пин патченой версии), §2 (Login v2 рассмотрен и отклонён).
