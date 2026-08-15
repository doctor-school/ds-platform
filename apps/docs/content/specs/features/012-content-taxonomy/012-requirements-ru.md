---
title: "012 — Контентная таксономия: проекты, эксперты, темы и партнёры"
description: "Требования к полноценным сохраняемым сущностям проектов, экспертов, тем и партнёров; их сохраняемым связям многие-ко-многим с мероприятиями и друг с другом; постепенной явной миграции свободнотекстовых спикеров; операторскому интерфейсу platform_admin на Refine; и безопасным двунаправленным REST-чтениям для последующих поверхностей Академии."
slug: 012-content-taxonomy-ru
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1280
issues:
  [
    1282,
    1283,
    1284,
    1285,
    1286,
    1287,
    1288,
    1289,
    1290,
    1291,
    1292,
    1293,
    1294,
    1295,
    1296,
    1297,
    1298,
    1299,
    1300,
  ]
prior_decisions:
  - ADR-0014 — Жизненный цикл продуктового дизайна и поставки (§2 PRD → трасса EARS `realizes:`; Stage A предшествует реализации user-facing поверхности)
  - "ADR-0001 — Identity / Auth / RBAC (admin-чтения и команды: `access: authenticated`, `required_roles: platform_admin`; публичные чтения: `access: public`)"
  - ADR-0002 — Backend Core Stack (NestJS + nestjs-zod; REST/OpenAPI под `/v1`; cursor-пагинация публично, offset в admin; RFC 7807; идемпотентность)
  - ADR-0003 — Data Layer (§4 retained-row lifecycle; Postgres + Drizzle; restrictive FK; без физического удаления и каскадов)
  - ADR-0004 — Frontend Stack (§3 существующая Refine-поверхность `apps/admin` с custom providers поверх NestJS API)
  - ADR-0013 — Единый источник дизайн-токенов и design-system-first гейт
  - ADR-0006 — Documentation & SSOT (§4 триплет feature-spec + плоская нумерация EARS)
lang: ru
---

> **RU (это)** · **EN:** [`012-requirements-en.md`](./012-requirements-en.md)
>
> Источник PRD: [`012-product-ru.md`](./012-product-ru.md) (US-1…US-12). Эпик: [«Публичная поверхность Академии»](../../product/academy-public/brief-ru.md). У фичи 012 есть операторский UI в admin, поэтому `surface: user-facing`; публичные страницы Академии остаются за 013–016.

# 012 — Контентная таксономия (Требования)

## Результаты

- Контент-оператор один раз описывает проект, эксперта, тему или партнёра и везде переиспользует ту же сохраняемую запись.
- Мероприятия связаны с несколькими проектами, экспертами и темами настоящими m2m-строками; проекты связаны с экспертами и партнёрами в обоих направлениях.
- Эксперт — одна самостоятельная редакционная запись. `project_experts.role` равен `curator | member`; `event_experts` несёт роль на мероприятии, позицию и опциональное явное сопоставление с одной legacy-строкой спикера.
- Существующие свободнотекстовые спикеры продолжают отображаться во время постепенной миграции. Связанный опубликованный эксперт заменяет в текущей проекции только явно сопоставленную legacy-строку; нет сопоставления по имени, дедупликации, перезаписи или неявного вывода строки из оборота.
- Операторы создают, ищут, редактируют, публикуют, выводят из оборота и восстанавливают таксономию в существующей Refine-админке. Действия Delete нет.
- Последующие поверхности Академии читают безопасные публичные записи и каждое направление связей через REST `/v1`; копии, экспорта или шага синхронизации нет.

## Рамки

**Входит:**

- Верхнеуровневые сохраняемые сущности:
  - `projects`: стабильные id + slug, название, описание, ссылка на медиа обложки;
  - `experts`: стабильные id + slug, имя, ссылка на фото, регалии, био; FK на пользователя платформы в 012 нет;
  - `topics`: стабильные id + slug и название, поддерживаемый курируемый список;
  - `partners`: стабильные id + slug, название, ссылка на логотип и URL сайта.
- Общие поля сущности: `status: draft | published | retired`, nullable `deleted_at`, монотонная `version` и timestamps. Создание начинает с `draft`; восстановление возвращает в `draft`.
- Сохраняемые джойны: `event_projects`, `event_experts`, `project_experts`, `project_partners`, `event_topics`; у каждого стабильный id, `status: active | retired`, nullable `deleted_at`, `version`, timestamps и уникальность логической пары концов.
- `event_experts`: обязательная роль именно на мероприятии, неотрицательная `position` и nullable unique `legacy_speaker_id`. Runtime-prerequisite #1278 даёт существующим `event_speakers` стабильную идентичность и retained-row семантику, чтобы сопоставление не смещалось при редактировании мероприятия.
- Refine-ресурсы списка/детали/создания/редактирования сущностей и lifecycle-действий; редакторы связей на соответствующих формах мероприятия/проекта; поиск и явные фильтры сохранённых строк.
- Безопасные публичные чтения сущностей, двунаправленные чтения связей и объединённая текущая проекция спикеров.

**Не входит:**

- Врачебный рендеринг: `/`, фасеты/архив `/webinars`, `/projects`, `/experts` и их страницы относятся к 013–016.
- `event_recordings`, `leads`, Payload CMS, коммерческие условия/договоры партнёров, публичный поиск по таксономии, рекомендации/ранжирование, массовая миграция спикеров, самообслуживание эксперта или связь user↔expert.
- Новые роли или концепции политики доступа; 012 переиспользует `platform_admin`.
- Универсальный интерфейс просмотра аудита. Фича 010 уже пишет мутации в `audit_ledger`; 012 лишь сохраняет строки адресуемыми для просмотра/восстановления.

## Ограничения

- **Только retained rows.** Ни один прикладной путь не выполняет `DELETE`, `TRUNCATE`, data-bearing drop, `ON DELETE CASCADE` и не переиспользует идентификаторы этих сущностей, джойнов или мигрированных `event_speakers`. Все FK — `RESTRICT`/`NO ACTION`.
- **Согласованный lifecycle.** `retired` тогда и только тогда, когда `deleted_at` не null; у `draft`, `published` и `active` он null. Переходы сущности: `draft → published`, `draft|published → retired`, `retired → draft`; джойна: `active → retired → active`. Вывод сущности из оборота никогда не меняет её джойны.
- **Публичный default deny.** Публичные чтения включают только сущности `published` с `deleted_at IS NULL`, джойны `active` с `deleted_at IS NULL` и мероприятия, разрешённые существующей публичной политикой событий. Публичные draft/retired/unknown дают одинаковую форму 404.
- **Явное чтение сохранённого.** Admin-списки по умолчанию показывают не-retired сущности / active джойны. Сохранённые строки появляются только при явном status или `includeRetired=true`; admin-detail по стабильному id остаётся доступен для восстановления.
- **Одна текущая проекция спикеров.** Active-сопоставление подавляет matched legacy-строку только при опубликованном не-retired эксперте. Иначе legacy-фолбэк остаётся. Строки сортируются по `position ASC`, затем source rank (`expert` перед `legacy`), затем стабильному row id; одинаковые имена никогда не дедуплицируются.
- **Полнота публикации.** Draft может быть неполным. Публикация требует все публичные поля вида; проект дополнительно требует ровно одну active-связь `curator` с допустимым published/non-retired экспертом.
- **Без заглушек.** Схема, миграции, API, generated SDK, Refine UI и браузерная проводка поставляются настоящими вертикальными слайсами. Seeds, fake repositories, placeholder-селекторы и ручные шаги в БД не закрывают EARS.
- **Сохраняемые записи идемпотентности.** Idempotency row остаётся `active` 24 часа replay-окна, затем истекает UPDATE-переходом в `status='expired'` + `deleted_at`; она хранится навсегда, никогда не TTL-delete и не переиспользуется.

## Prior decisions

- **ADR-0003 §4:** каждая прикладная сущность и связь сохраняется; обычные чтения фильтруют `deleted_at IS NULL`, historical/restore чтения подключают строки явно, все FK restrictive.
- **ADR-0002 §§3–4, 9:** Zod — SSOT запросов/ответов, REST версионирован под `/v1`, растущие публичные списки используют opaque cursor, admin-таблицы могут использовать offset, ошибки мутаций — RFC 7807, мутации идемпотентны.
- **ADR-0004 §3:** редактирование таксономии расширяет существующую Refine-админку через custom data/auth/access providers; второй backend и Payload CMS не создаются.
- **ADR-0013 + AGENTS.md §6:** реализация проходит design-system-first гейт; interaction states и token discipline приходят из `@ds/design-system`.
- **Фича 007:** текущий агрегат мероприятия владеет `specialties[]` и упорядоченными `event_speakers`; 012 добавляет таксономию рядом и переводит reconciliation спикеров с физической замены на стабильные сохраняемые строки.
- **Фича 010:** все новые таблицы получают generic audit trigger, поэтому мутации пишут атрибутированные `data.<table>.<op>` без отдельной реализации аудита таксономии.

## Технические решения лида

- **LD-1 — оптимистические версии для гонок редактирования.** ADR-0002 требует идемпотентность, но не мешает двум разным валидным запросам перезаписать друг друга. Поэтому каждая mutable taxonomy/speaker-строка несёт монотонную `version`, возвращаемую как ETag; PATCH и lifecycle/link команды требуют `If-Match`. Тот же precondition связывает подтверждение retire с версией, для которой показан impact, закрывая окно TOCTOU preview→confirm. Устаревшее условие возвращает 412 без мутации.
- **LD-2 — стабильный порядок объединённых спикеров.** `position` задаёт редакционный порядок. Полный tie-break: `position ASC`, source rank (`expert` перед `legacy`), stable row id ASC; write path также отвергает конфликт видимого слота, кроме случая, когда mapped expert намеренно занимает позицию подавленной legacy-строки. Поэтому чтение всегда детерминировано и не зависит от имени.

## Модель событий

### Команды

- `CreateTaxonomyEntity(kind, fields)` / `UpdateTaxonomyEntity(kind, id, fields)` — создать сущность в `draft` или изменить ту же сохраняемую строку.
- `PublishTaxonomyEntity(kind, id)` — `draft → published` после валидации публичной проекции.
- `PreviewRetirement(target)` — вернуть текущие видимые связанные проекции, которые уберёт вывод сущности или джойна из оборота.
- `Retire(target)` / `Restore(target)` — явные lifecycle-переходы без каскада; сущность восстанавливается в `draft`, джойн — в `active`.
- `CreateRelationship(kind, endpoints, attributes)` / `UpdateRelationship(id, attributes)` — создать или изменить один сохраняемый джойн; `event_experts` принимает `role`, `position` и опциональный `legacySpeakerId`.

Каждая мутация требует `Idempotency-Key`; каждое обновление/переход — текущую версию в `If-Match`.

### События

| Событие                                                    | Смысл                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `TaxonomyEntityCreated/Updated/Published/Retired/Restored` | Изменились данные или состояние одной сущности; фича 010 пишет diff строки в той же транзакции.                     |
| `TaxonomyRelationshipCreated/Updated/Retired/Restored`     | Изменилась одна явная связь; концы и соседние связи не меняются.                                                    |
| `EventSpeakerMatched`                                      | Строка `event_experts` теперь явно ссылается на одного сохранённого legacy-спикера; сама legacy-строка не меняется. |

### Модели чтения

- `TaxonomyAdminList/Detail` — все поля редактирования, status, version и сводки связей; page/offset, поиск и явные retained-фильтры.
- `PublicProject`, `PublicExpert`, `PublicTopic`, `PublicPartner` — только allow-list публичных полей из авторских строк.
- Двунаправленные коллекции связей — оба конца всех пяти джойнов, с публичной cursor-пагинацией `{ data, pagination: { nextCursor, hasMore } }`.
- `PublicEventSpeaker[]` — детерминированное объединение допустимых экспертов и несопоставленных сохранённых свободнотекстовых спикеров.
- `RetirementImpact` — id/version цели и идентификаторы затрагиваемых сейчас публичных событий/проектов/экспертов/тем/партнёров; скрытого содержимого в ответе нет.

### Политики

- Slug и логические пары концов остаются уникальными среди сохранённых строк; конфликт создания направляет оператора к сохранённой строке для restore.
- У проекта не более одного active `curator`; остальные эксперты проекта — `member`. Legacy-спикер сопоставлен не более чем одной сохранённой строке `event_experts` и обязан принадлежать тому же событию.
- Тема выбирается только из существующих не-retired тем. `specialties[]` никогда не читается из `topics` и не записывается туда.
- Медиа используют существующую абстракцию object storage; публичные DTO отдают CDN URL, не storage keys. Retire/restore никогда не удаляет медиа.

## EARS-требования

> Плоская нумерация по ADR-0006 §4. Каждая формулировка реализует одну или несколько историй PRD и покрыта `012-scenarios.feature`.

- **EARS-1** _(realizes: US-1, US-9)_ — Когда `platform_admin` создаёт или редактирует проект через его Refine-ресурс, система должна сохранить одну полноценную retained-строку `projects` со стабильными id/slug/version, названием, описанием и ссылкой на обложку (draft может быть неполным) и показать ту же строку в list/detail; проект никогда не должен быть строкой мероприятия или второй копией.
- **EARS-2** _(realizes: US-2, US-9)_ — Когда `platform_admin` создаёт или редактирует эксперта через его Refine-ресурс, система должна сохранить одну самостоятельную редакционную строку `experts` со стабильными id/slug/version, именем, ссылкой на фото, регалиями и био (draft может быть неполным), без обязательной связи с пользователем платформы и параллельного типа эксперта.
- **EARS-3** _(realizes: US-5, US-9)_ — Когда `platform_admin` создаёт или редактирует тему через её Refine-ресурс, система должна сохранить одну курируемую строку `topics` со стабильными id/slug/version и названием; темы никогда не должны быть свободными тегами мероприятия.
- **EARS-4** _(realizes: US-6, US-9)_ — Когда `platform_admin` создаёт или редактирует партнёра через его Refine-ресурс, система должна сохранить одну описательную строку `partners` со стабильными id/slug/version, названием, ссылкой на логотип и URL сайта; коммерческие условия и контакты не являются полями публичного контракта.
- **EARS-5** _(realizes: US-1, US-2, US-5, US-6, US-10, US-12)_ — Когда оператор публикует валидную сущность из `draft`, система должна проверить все обязательные поля её публичной проекции и перевести её в `published`; у проекта дополнительно должен быть ровно один active `curator`, связанный с published/non-retired экспертом. Public list/detail после этого отдают только allow-list вида и CDN URL, а incomplete draft, retired и internal/storage поля остаются скрыты и неотличимы от unknown.
- **EARS-6** _(realizes: US-4, US-11)_ — Когда оператор связывает мероприятие с проектом, система должна создать или восстановить одну строку `event_projects`, позволить мероприятию иметь несколько проектов, отдать event→projects и project→events и не менять lifecycle концов побочным эффектом.
- **EARS-7** _(realizes: US-3, US-8)_ — Когда оператор связывает эксперта с мероприятием, система должна сохранить одну строку `event_experts` с обязательной ролью, неотрицательной позицией и опциональным явным `legacySpeakerId`; legacy id обязан указывать на retained-спикера того же события и быть уникальным среди retained expert links, а имя никогда не используется для сопоставления.
- **EARS-8** _(realizes: US-2, US-3, US-8, US-10)_ — Когда читается публичная проекция спикеров события, система должна объединить active-linked экспертов с active legacy-строками по полному порядку LD-2: допустимый published-эксперт заменяет только явно matched строку, а unmatched и fallback для draft/retired/unlinked эксперта остаются; match не перезаписывает, не retire и не name-dedupe legacy-строку.
- **EARS-9** _(realizes: US-1, US-2, US-11)_ — Когда оператор связывает эксперта с проектом, система должна сохранить одну строку `project_experts` с `curator | member`, обеспечить не более одного active curator и отдать project→experts и expert→projects с ролью.
- **EARS-10** _(realizes: US-6, US-11, US-12)_ — Когда оператор связывает партнёра с проектом, система должна сохранить одну строку `project_partners` и отдать project→partners и partner→projects только с title/logo URL/website URL; commercial/internal данные не входят в проекцию.
- **EARS-11** _(realizes: US-5, US-11)_ — Когда оператор размечает мероприятие, event form должна предложить только существующие non-retired темы без inline creation, сохранить одну строку `event_topics` на пару, отдать оба направления и оставить `specialties[]` побайтно неизменным.
- **EARS-12** _(realizes: US-10, US-11, US-12)_ — Когда public caller читает taxonomy collections или любое направление под `/v1/public`, система должна запросить те же авторские строки, применить published/active/non-deleted allow-list на каждом hop, использовать opaque cursor с `{ data, pagination: { nextCursor, hasMore } }`, не вернуть duplicate pair и не раскрыть draft, retired endpoint, inactive join или admin-only field.
- **EARS-13** _(realizes: US-7)_ — Когда оператор запрашивает retire сущности или связи, admin сначала должен показать `RetirementImpact` для той же версии и потребовать confirmation; сервер затем один раз выставляет `retired` + `deleted_at`, сохраняет строки/FK, не меняет lifecycle связанного и убирает цель из defaults/current public только фильтрацией.
- **EARS-14** _(realizes: US-7, US-8)_ — Когда оператор восстанавливает retained entity/relation, система должна очистить `deleted_at` и перевести entity в `draft`, join в `active`; detail и явный `includeRetired` обращаются к той же stable row, defaults её исключают. HTTP Delete route и Delete control не существуют.
- **EARS-15** _(realizes: US-9)_ — Когда оператор открывает список taxonomy resource, admin API и Refine table должны поддержать bounded page/offset, total, case-insensitive title/name/slug search и явные status/`includeRetired`; retired entity не появляется в new-link selector, empty result — успешная пустая page.
- **EARS-16** _(realizes: US-1, US-2, US-3, US-4, US-5, US-6, US-7, US-8, US-9, US-12)_ — Admin reads/commands должны быть `authenticated` / `platform_admin` (401 unauthenticated, 403 non-admin), public reads — `public`; validation/cursor — 400, unknown/non-public — 404, duplicate/invalid transition — 409, missing precondition — 428, stale version — 412, в RFC 7807 со стабильными `errorCode` и `traceId`.
- **EARS-17** _(realizes: US-7, US-10, US-11)_ — Система должна требовать `Idempotency-Key` для каждой мутации и повторять исходный результат для тех же actor/route/payload в 24-часовом active-окне, отвергая reuse с другим payload; expiry должна UPDATE эту application-owned row в `expired` + `deleted_at` и хранить её навсегда без delete/reactivate/reuse. По LD-1 mutable rows отдают version/ETag и меняются только при current `If-Match`; каждая committed mutation получает audit capture фичи 010 в той же транзакции.
- **EARS-18** _(realizes: US-1, US-2, US-3, US-4, US-5, US-6, US-7, US-8, US-9)_ — До старта любого нового/изменённого taxonomy/event-admin UI slice команда должна завершить Stage A: выполнить `build-ui-from-design-system`, представить 2–3 Refine-композиции и записать выбор владельца; реализация использует `@ds/design-system` с полными states и без Delete UI, а реальный результат проходит live Playwright и owner Stage B до merge.

## Инварианты

- Ни одна сущность таксономии, джойн или мигрированная legacy-строка спикера физически или каскадно не удаляется; стабильные ids/slugs/pairs не переиспользуются.
- `retired ⇔ deleted_at IS NOT NULL`; восстановление сущности всегда даёт `draft`, джойна — `active`.
- Публичная связь видима только при active-джойне и published/non-retired концах таксономии.
- Сопоставленная legacy-строка спикера остаётся сохранённой и неизменной; единственное правило подавления — явное допустимое сопоставление.
- `specialties[]` и topics — разные оси и никогда не синхронизируются.
- Одна авторская Postgres-строка питает admin и public проекции; export/sync/fake seam нет.
- Idempotency rows истекают retained-lifecycle UPDATE-переходом и никогда физически не удаляются или переиспользуются.

## Проверка

| EARS  | Тип теста                                 | Ориентировочная цель                                                               | Обязательное доказательство                                                                                                                           |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–5   | Vitest e2e + schema tests                 | отдельный bounded entity-kind suite на EARS                                        | Каждый вид создаётся/редактируется отдельно; publish completeness (включая curator), allow-list и draft/retired 404.                                  |
| 6–11  | Vitest e2e + DB constraints               | отдельный bounded join/projection suite на EARS                                    | Каждый join, обе cardinalities, curator/legacy constraints, порядок LD-2, topic isolation и отсутствие cascade.                                       |
| 12    | Vitest e2e + contract                     | `apps/api/test/taxonomy/public-reads.e2e-spec.ts`                                  | Оба направления, cursor boundaries и фильтрация на каждом hop; allow-list snapshot.                                                                   |
| 13–14 | Vitest e2e + migration test               | `apps/api/test/taxonomy/lifecycle.e2e-spec.ts`                                     | Preview-before-confirm, retire/restore, explicit retained reads, restrictive FK и отсутствие DELETE.                                                  |
| 15    | Vitest e2e + Playwright                   | `apps/api/test/taxonomy/admin-list.e2e-spec.ts`, `apps/admin/e2e/taxonomy.spec.ts` | Search/page/status/retained filters и selectors на реальном API.                                                                                      |
| 16–17 | Vitest e2e                                | `apps/api/test/taxonomy/protocol.e2e-spec.ts`                                      | Authz, точные Problem Details, idempotent replay, key collision, 428/412 и audit rows.                                                                |
| 18    | Playwright + axe + UI lint + owner record | `apps/admin/e2e/taxonomy.spec.ts`                                                  | Stage-A решение записано первым; create/link/retire/restore, reject+accept/error timing, keyboard states, оба breakpoint/theme; live Stage-B verdict. |
| все   | Playwright BDD                            | `012-scenarios.feature`                                                            | Каждый EARS tag исполняется на настоящем Refine admin + NestJS/Postgres stack; stub/seed-only acceptance запрещён.                                    |

## Зависимости и последовательность

- Фича 007 даёт существующую форму мероприятия и legacy-проекцию спикеров; #1278 делает speaker rows стабильно retained, а 012 добавляет явный expert match/current-projection без поломки немигрированных событий.
- GitHub [#1278](https://github.com/doctor-school/ds-platform/issues/1278) — critical-path implementation prerequisite после merge спеки и до любой новой entity 012: он владеет retained-row conformance текущих таблиц, стабильными `event_speakers`, idempotency expiry и удалением существующих cascade/delete paths. 012 потребляет этот runtime и не дублирует его.
- Фича 010 даёт generic audit capture; каждая новая таблица таксономии должна попасть под его coverage guard.
- 013–016 потребляют публичное API только после попадания этой спеки в `main`; весь врачебный рендеринг принадлежит им.
- EARS-18 Stage A — первый UI-гейт и блокирует UI-части EARS-1…15; каждый entity kind и каждый join/projection остаётся отдельным bounded vertical slice, а не одним CRUD issue на четыре сущности.
