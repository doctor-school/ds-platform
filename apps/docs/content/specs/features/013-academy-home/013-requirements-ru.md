---
title: "013 — Публичная главная Академии и надёжный сбор партнёрских лидов"
description: "Продакшен-требования к курируемой владельцем главной Академии на /, рабочей навигации и входу, а также согласованному идемпотентному сбору лида с сохранением до надёжной асинхронной доставки в Mattermost."
slug: 013-academy-home-requirements-ru
product: ./013-product-ru.md
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1307
issues:
  - 1307
prior_decisions:
  - "ADR-0014: трассировка PRD → EARS и утверждённый владельцем источник Stage A"
  - "ADR-0013: @ds/design-system как источник истины токенов и компонентов"
  - "ADR-0006 §4: двуязычные продуктовые требования, плоская нумерация EARS, SDD-триплет"
  - "ADR-0004: пользовательская поверхность портала Next.js"
  - "ADR-0002: NestJS, SSOT Zod-схем, версионированный REST, авторизация эндпоинтов"
  - "ADR-0003: удерживаемый жизненный цикл Postgres, транзакционный outbox, доставка BullMQ"
  - "ADR-0009: неизменяемое доказательство согласия, retention, стирание и жизненный цикл ПД"
  - "ADR-0011: разрешённый и fail-closed egress из российского периметра ПД"
  - "ADR-0012: продакшен-топология notifications worker"
lang: ru
---

> **RU (это)** · **EN:** [`013-requirements-en.md`](./013-requirements-en.md) · источник PRD: [`013-product-ru.md`](./013-product-ru.md), US-1…US-12.

# 013 — Публичная главная Академии и надёжный сбор партнёрских лидов

## Результаты

- Публичный `/` становится входной дверью Академии: точная утверждённая владельцем композиция и русский контент из PRD, без редиректа на `/webinars` и без зависимости от динамической CMS/таксономии.
- Каждый видимый контрол работает в продакшене: десктопная навигация, мобильное меню, тема, вход, канонические ссылки контента, CTA, политика, прямые контакты, состояния формы и ссылки подвала.
- Валидная партнёрская заявка становится удерживаемым лидом в базе с неизменяемым серверным доказательством согласия до показа успеха; Mattermost — надёжная асинхронная доставка, а не источник истины.
- Повторы из-за сетевой неопределённости браузера или воркера не дублируют и не теряют лид; отказ, лог, метрика, outbox payload и API-ответ не раскрывают ПД.
- Полный путь проверяется настоящим браузером на desktop/mobile × light/dark: reject/accept, неопределённый retry, сбой уведомления, интерактивные состояния и axe.

## Скоуп

**Входит:**

- Публичный маршрут Next.js-портала `/` с точным порядком секций, текстами, двумя каноническими строками, шестью портретами, fixture проектов/партнёров/форматов, подвалом и ассетами, зафиксированными PRD на коммите `apps/academy-demo` `7330e4d8a99bdeca73285e2b4eabf09d7021788c`.
- Настоящая навигация шапки/подвала, рабочие мобильное меню и тема, существующий flow входа и дефолт `/webinars` после входа без сохранённого назначения.
- Настоящая доступная партнёрская форма: обязательное имя; необязательная компания; обязательный email или Telegram; необязательный селект роли; обязательное согласие; loading, понятные validation/error и success.
- Публичный `POST /v1/academy/leads`, типизированные request/response-схемы, специальные защиты публичного эндпоинта, идемпотентность, сохранение удерживаемого лида/согласия, audit context и маскирование ПД.
- Первый продакшен producer/drainer `job_outbox` и процесс `notifications-worker` для критичной доставки лидов Академии через BullMQ и выделенный Mattermost webhook.
- Схема окружения/preflight для `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`, доступного только notifications worker.

**Не входит:**

- Динамический контент CMS/таксономии, автоматический выбор/перестановка мероприятий и редактор главной; первый релиз курируется владельцем.
- Доставка каталогов/детальных страниц `/projects` и `/experts`; до их выхода навигация главной использует реальные секции страницы.
- Поведение целевых страниц мероприятий, регистрация/комната/записи, CRM-стадии, назначение/админка лидов, письмо-подтверждение и маркетинговая автоматизация.
- Редактирование политики `https://doctor.school/index/privacy-pay`; 013 считывает её неизменяемую активную версию для доказательства.
- Открытие дочерних Issues, PR или реализация в рамках этого spec-authoring pass.

## Ограничения

- **Точный контент и только DS UI.** PRD и зафиксированный коммит — fidelity-контракт. Весь UI использует токены/примитивы `@ds/design-system`; запрещены заменяющий текст/портрет/метрика/контрол, произвольное Tailwind-значение, отключённое демо-поведение и выдуманный блок.
- **Классификация публичного эндпоинта.** `POST /v1/academy/leads` — `@Public`, со специальным scope `@RateLimited`, `@BotProtected("academy-lead")` и high-stakes/audited `@Authz`. `Idempotency-Key` обязателен; ответ не содержит отправленные ПД.
- **Атомарное принятие.** Одна транзакция `withRequestAuditContext` создаёт удерживаемую строку `academy_leads`, неизменяемое доказательство согласия, `job_outbox` с единственным payload `{leadId}` и завершённую idempotency-запись. Commit предшествует accepted API response и success UI.
- **Серверное доказательство согласия.** Сервер ставит точный URL политики, неизменяемый tag активной версии, нормализованный snapshot содержимого или устойчивую ссылку на него с SHA-256 и `acceptedAt` по часам БД. Поля доказательства от клиента игнорируются. Существующая таблица `consent_records` с обязательным user FK не переиспользуется для гостя без изменения.
- **Удерживаемые строки.** До миграции политика lead/evidence/outbox добавляется в retention matrix в коде. Принадлежащие приложению строки не удаляются физически/cascade как обычный жизненный цикл; применяются status/`deletedAt`, append-only evidence, value erasure, tombstone и crypto-shred по классификации ADR-0003/0009.
- **Нет ПД на операционных поверхностях.** Таблицы лида регистрируются в audit PD masking. Имя, компания, контакт, webhook URL и message payload не попадают в logs/errors/metrics/traces или outbox JSON.
- **Надёжное уведомление.** Postgres outbox остаётся авторитетным при сбое Redis/рестарте. BullMQ job id равен outbox id; доставка at-least-once, consumer идемпотентен. Истёкшие claims подбираются снова; retry использует exponential backoff с jitter; exhausted строки удерживаются, алертятся и доступны для replay.
- **Граница секрета и egress.** Только `notifications-worker` получает `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`; запрещены fallback на `MATTERMOST_WEBHOOK_URL`, `NEXT_PUBLIC_*` и логирование секрета. ADR-0011 требует подтверждённое российское/одобренное размещение назначения и allowlist; иначе отправка fail closed, а лид остаётся pending.

## Предыдущие решения

- **ADR-0014 §1–2** — PRD является источником результатов и стабильных `US-N`; каждый EARS содержит `realizes:`.
- **ADR-0013** — UI fidelity задают компоненты/токены в коде и утверждённый владельцем источник; live Stage B обязателен.
- **ADR-0006 §4** — двуязычные продуктовые требования, плоские EARS id, design и scenarios только EN.
- **ADR-0004** — публичная поверхность принадлежит Next.js portal и сохраняет существующую интеграцию входа.
- **ADR-0002** — NestJS + Zod REST, `/v1`, явный endpoint authz, Vitest/supertest.
- **ADR-0003** — Postgres/Drizzle, удерживаемые строки приложения, транзакционный durable outbox, семантика BullMQ.
- **ADR-0009** — неизменяемое версионированное доказательство согласия, retention/erasure ПД и retention matrix в коде.
- **ADR-0011** — egress ПД минимален, allowlisted, audited и fail-closed.
- **ADR-0012** — notifications worker развёртывается отдельно с least-privilege конфигурацией.

## Модель событий

### Команды

- `SubmitAcademyLead(canonicalPayload, idempotencyKey)` — проверить, защитить, зафиксировать согласие и атомарно принять один лид.
- `DrainLeadNotificationOutbox(outboxId)` — захватить готовую удерживаемую строку и поставить BullMQ job с `jobId = outboxId`.
- `DeliverAcademyLeadNotification(outboxId)` — загрузить минимум полей по `leadId`, проверить egress, отправить в приватный канал лидов Академии и подтвердить доставку.
- `ReplayExhaustedLeadNotification(outboxId)` — авторизованный операционный replay удерживаемой exhausted-строки без нового лида.

### События

| Событие                                 | Минимальный payload                                                   | Смысл                                                                 |
| --------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AcademyLeadAccepted`                   | `leadId`, `outboxId`, `acceptedAt`                                    | Транзакция закоммичена, посетителю можно показать успех.              |
| `AcademyLeadNotificationQueued`         | `outboxId`, `attempt`                                                 | BullMQ job идемпотентно доступен.                                     |
| `AcademyLeadNotificationDelivered`      | `leadId`, `outboxId`, provider receipt без ПД                         | Приватное назначение подтвердило сообщение.                           |
| `AcademyLeadNotificationRetryScheduled` | `outboxId`, `attempt`, `nextAttemptAt`, классифицированный error code | Временная/неопределённая ошибка остаётся pending.                     |
| `AcademyLeadNotificationExhausted`      | `outboxId`, `attempt`, классифицированный error code                  | Автопопытки закончились; строка удерживается, алертится и replayable. |

### Read models

- `AcademyHomeContent` — неизменяемая курируемая владельцем композиция/ассеты из source pin PRD.
- `AcademyLeadAcceptedResponse` — непрозрачный `submissionId`, accepted status и никаких name/company/contact/consent/webhook полей.
- `AcademyLeadDeliveryStatus` — ограниченный операционный view по стабильным lead/outbox id, состоянию, попыткам и времени; без webhook secret и лишних ПД.
- `ActiveLeadPolicyVersion` — неизменяемые version tag, точный URL, нормализованный snapshot/reference, SHA-256 и период действия.

### Политики

- **Валидация:** имя и контакт обязательны; контакт — валидный email или Telegram username; company/role необязательны; consent=true.
- **Идемпотентность:** тот же key + тот же canonical payload возвращает исходный accepted response без нового lead/outbox/message; тот же key + другой payload возвращает conflict.
- **Принятие:** commit БД — граница успеха; Mattermost не блокирует и не отменяет accepted response.
- **Уведомление:** только необходимые поля и стабильный не-ПД lead id для распознавания дубля после неопределённого timeout; только приватный авторизованный канал лидов Академии.
- **Egress:** неподтверждённый периметр/residency или отсутствие allowlist/secret оставляет outbox pending/exhausted и создаёт только PD-free alert; отправки в другое место нет.

## Требования EARS

> Плоская нумерация по ADR-0006 §4. Каждый пункт реализует стабильные истории PRD.

- **EARS-1** _(realizes: US-1, US-5, US-12)_ — Когда любой посетитель запрашивает `/`, система должна без авторизации и редиректа отрисовать публичную главную Академии в точном порядке **hero → Что → Люди (сначала Проект, затем шесть экспертов) → Эфиры → Зачем → Проекты → ценность партнёра → форматы → настоящая лид-форма → подвал**, с одним полноширинным партнёрским hero и точным русским текстом владельца.
- **EARS-2** _(realizes: US-1, US-5, US-12)_ — Главная Академии должна использовать только ассеты и курируемые fixture, зафиксированные `013-product-ru.md` на коммите `7330e4d8a99bdeca73285e2b4eabf09d7021788c`, включая `14 партнёров · прозрачная модель`, и не должна содержать динамическую ленту CMS/таксономии, заменяющий текст/портрет, отключённый демо-контрол или ложную метрику проекта.
- **EARS-3** _(realizes: US-2, US-4, US-12)_ — Секция «Люди» должна показывать блок Проекта `Кто стоит за брендом` до ровно шести карточек экспертов с точными именами, регалиями и переданными портретами; блок Проекта и «Эфиры» должны показывать одни и те же две канонические строки в одном порядке, включая точный B2B href `https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd`.
- **EARS-4** _(realizes: US-3, US-10)_ — Когда посетитель активирует навигацию шапки/подвала, мобильное меню, логотип, тему, вход, строку контента, прямой контакт, политику или CTA, система должна выполнить настоящее задокументированное назначение/поведение; успешный вход без более приоритетного сохранённого назначения должен вести прямо на `/webinars`, а явный запрос `/` оставаться на публичной главной.
- **EARS-5** _(realizes: US-11, US-12)_ — Система должна отрисовать всю DS-only поверхность и видимые hover/active/focus/loading/error/success состояния на desktop/mobile в light/dark, с клавиатурным управлением и без нарушений axe WCAG 2 A/AA.
- **EARS-6** _(realizes: US-6)_ — Когда посетитель пытается отправить форму с отсутствующим/невалидным именем или email/Telegram либо без согласия, браузер не должен делать lead request/write, должен сохранить остальные валидные значения и сфокусировать/связать понятную ошибку с полем; при валидных данных он должен переиспользовать один сгенерированный `Idempotency-Key` во время loading и transport retry.
- **EARS-7** _(realizes: US-6, US-9)_ — Когда любой клиент вызывает `POST /v1/academy/leads`, API должен применить `@Public`, специальный `@RateLimited`, `@BotProtected("academy-lead")`, high-stakes/audited `@Authz`, schema validation и обязательный `Idempotency-Key`; ответы 429, bot, validation, conflict и accepted должны быть общими/понятными по назначению и не повторять ПД.
- **EARS-8** _(realizes: US-7, US-8, US-9)_ — Когда защищённая валидная новая заявка принимается, одна транзакция `withRequestAuditContext` должна создать одну удерживаемую `academy_leads`, неизменяемое доказательство согласия с restrictive link, одну `job_outbox` только с `{leadId}` и завершённую idempotency-запись; лишь после commit API возвращает accepted, а браузер показывает `Заявка отправлена`.
- **EARS-9** _(realizes: US-6, US-9)_ — Когда EARS-8 фиксирует согласие, сервер должен поставить точный URL `https://doctor.school/index/privacy-pay`, неизменяемый tag активной версии, нормализованный snapshot/reference с SHA-256 и `acceptedAt` по часам БД; он не должен доверять evidence tuple клиента или без изменения переиспользовать существующую госте-несовместимую модель `consent_records` с user FK.
- **EARS-10** _(realizes: US-7, US-9)_ — Когда `POST /v1/academy/leads` снова получает тот же `Idempotency-Key` и тот же canonical payload, система должна вернуть идентичный accepted result без нового лида, consent/outbox или уведомления; тот же key с другим canonical payload должен дать conflict без записи.
- **EARS-11** _(realizes: US-8, US-9)_ — После commit лида durable Postgres outbox drainer должен переживать сбои Redis/процессов, подбирать expired claims и ставить at-least-once BullMQ job с `jobId = outboxId`; идемпотентный notifications worker завершает удерживаемый outbox только после delivery acknowledgement.
- **EARS-12** _(realizes: US-8, US-9)_ — При доставке лида только notifications worker должен читать `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`, никогда не использовать fallback `MATTERMOST_WEBHOOK_URL` и не раскрывать его как `NEXT_PUBLIC_*`, загружать данные по `{leadId}` и отправлять минимум необходимых полей со стабильным lead id только в приватный авторизованный канал лидов Академии без логирования секрета/payload.
- **EARS-13** _(realizes: US-8)_ — Если Mattermost отвечает временной ошибкой или неопределённым timeout, доставка должна оставаться pending и повторяться с exponential backoff + jitter; exhausted попытки удерживаются, алертятся, доступны для просмотра/replay и не отбрасываются, а стабильный lead id обеспечивает распознавание дубля.
- **EARS-14** _(realizes: US-8, US-9)_ — Пока назначение Mattermost не подтверждено как российское/находящееся в одобренном периметре ПД и явно не внесено в allowlist ADR-0011, воркер должен fail closed без отправки, удерживать lead/outbox для retry или авторизованного replay и создавать только PD-free operational signal.
- **EARS-15** _(realizes: US-9)_ — Система должна до миграции зарегистрировать жизненный цикл lead/evidence/outbox в retention matrix кода, удерживать принадлежащие приложению строки без physical delete/cascade, применять классифицированные status/`deletedAt`/append-only/value-erasure/tombstone/crypto-shred, добавить данные лида в audit PD masking и исключить имя, компанию, контакт, webhook URL и message payload из logs/errors/metrics/traces.
- **EARS-16** _(realizes: US-1, US-2, US-3, US-6, US-7, US-8, US-10, US-11, US-12)_ — До приёмки фичи 013 browser E2E должен доказать точные контент/порядок/навигацию/меню/вход/канонические ссылки, отсутствие запроса при invalid form, valid acceptance, retry после network ambiguity без дубля, success после persistence при notification outage/fail-closed, оба breakpoints × обе темы, axe и видимые hover/active/focus/loading/error/success.

## Инварианты

1. `/` — публичная главная; дефолт после входа — `/webinars`.
2. Source pin PRD — SoT контента/композиции; обе копии канонических строк идентичны.
3. Один idempotency key соответствует не более чем одному canonical payload и одной принятой транзакции лида.
4. Accepted означает атомарный commit lead + consent evidence + outbox + idempotency record.
5. Consent evidence ставится сервером, неизменяемо и restrictively связано с удерживаемым лидом.
6. Outbox payload — только `{leadId}`; ПД и webhook secrets не входят в него или операционную телеметрию.
7. Postgres — durable truth; Redis/BullMQ и Mattermost — механизмы доставки.
8. Доставка at-least-once и consumer-idempotent; сбои удерживаются и replayable.
9. Egress без подтверждённого российского/одобренного периметра и allowlist — fail-closed.
10. Принадлежащие приложению lead/evidence/outbox строки не удаляются физически как обычный lifecycle.

## Верификация

| EARS  | Слой                             | Обязательное доказательство                                                                                                                                                    |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–5   | Portal Playwright                | Точный порядок/тексты/ассеты, 6 портретов, две копии канонических строк/hrefs, все реальные контролы, login default, desktop/mobile × light/dark, состояния, screenshots, axe. |
| 6     | Portal Playwright + client unit  | Invalid input/consent не создаёт request; ввод сохранён; valid submit создаёт/переиспользует один key.                                                                         |
| 7, 10 | API Vitest e2e + unit            | Decorator/authz matrix, validation, 429/bot, same-key replay, different-payload conflict, PD-free bodies.                                                                      |
| 8–9   | API/Postgres integration         | Одна транзакция и rollback; restrictive FK; DB-clock immutable policy evidence; commit до 202; нет guest reuse `consent_records`.                                              |
| 11–14 | Worker/outbox/BullMQ integration | Recovery Redis/restart, reclaim claims, job-id dedupe, ack boundary, ambiguous retry, exhaustion/replay, secret isolation, ADR-0011 fail-closed.                               |
| 15    | Migration/lint/security tests    | Retention matrix, нет cascade/delete lifecycle, audit masking, redaction logs/errors/metrics/traces.                                                                           |
| 16    | End-to-end Playwright            | Reject → accept → success, ambiguous retry/no duplicate, outage/fail-closed success после persistence, login route, visual/a11y matrix.                                        |

Продакшен-тесты используют `it('EARS-N: …')`; Gherkin-теги напрямую соответствуют плоским id.
