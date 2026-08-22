---
title: "Эпик «Doctor.School relaunch — two-site IA» — входной пакет discovery"
description: "Вход эпика relaunch платформы в две витрины: doctor.school (витрина врача) и academy.doctor.school (закулисье: эксперты, инвесторы). Пакет discovery (REQ-1…142, OWD-1…13, словарь, решение эксперт ↔ учётка, статус, сводка ревью), карта экранов и clickable wireframe R4 — переехали как мастер из репо bbm. Что из пакета должно родиться дальше: ADR архитектуры под две витрины → сверка канвасов с макетом → функциональная карта и нарезка фич по ADR-0014 → сборка."
slug: two-site-ia-readme-ru
milestone: https://github.com/doctor-school/ds-platform/milestone/13
parent_issue: https://github.com/doctor-school/ds-platform/issues/1430
status: "Discovery closed (DSP-252) · wireframe R4 owner-approved (DSP-251) · stage 1: ADR-0015 topology on main (#1432); ADR-0016 core model — #1433 in authoring"
lang: ru
---

> **RU (это)** · **EN:** [`README.md`](./README.md)

> **Решение владельца (Product Lead), 2026-08-22 — «го» на relaunch платформы в две витрины:** `doctor.school` — витрина врача; `academy.doctor.school` — закулисье (эксперты, инвесторы/партнёры). Трекер эпика — [#1430](https://github.com/doctor-school/ds-platform/issues/1430), milestone [«Doctor.School relaunch — two-site IA»](https://github.com/doctor-school/ds-platform/milestone/13).

## Что это за пакет

Входной материал эпика — результат discovery-сессий 2026-08-18 → 2026-08-22 (Plane `doctor-school`: DSP-244 → DSP-249 → DSP-252 — discovery; DSP-251 — wireframe). Это **не спека**: реестр требований и решений, словарь, статус и согласованный владельцем clickable-макет. Продуктовый бриф эпика (`brief.md` / `brief-ru.md`), PRD фич и EARS-триплеты рождаются из него на этапе 3 (ниже) по штатному конвейеру ADR-0014.

**Откуда переехал.** Репо `bbm` (BBM, холдинг), коммит `38487fd`:

- `outputs/2026-08-18-discovery-ds-academy-vs-doctors/` — пакет discovery;
- `outputs/2026-08-20-ds-wireframe/` — wireframe и карта экранов.

Мастер теперь здесь (документация Doctor.School живёт в `ds-platform`); в `bbm` остаются стаб-указатели. Содержимое перенесено **дословно** — изменены только имена файлов (конвенция `-ru` для RU-документов), добавлены frontmatter и строка провенанса в начале каждого файла. Внутри текстов ссылки вида `outputs/…` и прежние имена файлов — исторические; соответствие — в таблице ниже.

## Состав

| Здесь                                                      | Было в `bbm`                         | Что это                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`requirements-ru.md`](./requirements-ru.md)               | `…discovery…/requirements.md`        | Реестр **REQ-1…142**, NG, CON, Q. **Нумерация REQ сохранена** — по ней размечен макет                                                                                                                                                                       |
| [`one-way-doors-ru.md`](./one-way-doors-ru.md)             | `…discovery…/one-way-doors.md`       | Необратимые решения **OWD-1…13**                                                                                                                                                                                                                            |
| [`discovery-glossary-ru.md`](./discovery-glossary-ru.md)   | `…discovery…/glossary.md`            | Рабочий RU-словарь discovery. **Не разложен** по file-per-term глоссарию репо (`apps/docs/content/product/glossary/`) — интеграция в глоссарий = отдельный шаг                                                                                              |
| [`brainstorm-q-27-ru.md`](./brainstorm-q-27-ru.md)         | `…discovery…/brainstorm-Q-27.md`     | Решение «эксперт ↔ учётка» (REQ-106): кнопка «Это я» → ручное подтверждение админом                                                                                                                                                                         |
| [`next-steps-ru.md`](./next-steps-ru.md)                   | `…discovery…/next-steps.md`          | Статус/повестка discovery; материал для Commit-полосы (§7)                                                                                                                                                                                                  |
| [`review-r1-synthesis-ru.md`](./review-r1-synthesis-ru.md) | `…discovery…/review-R1-synthesis.md` | Сводка двух независимых ревью с решением по каждому замечанию                                                                                                                                                                                               |
| [`screens-ru.md`](./screens-ru.md)                         | `…wireframe/screens.md`              | Карта экранов макета ↔ REQ, история ревизий R2/R3/R4, CJM-обоснование                                                                                                                                                                                       |
| [`wireframe.html`](./wireframe.html)                       | `…wireframe/wireframe.html`          | Clickable wireframe обоих сайтов, **R4** (согласован владельцем 2026-08-22). Самодостаточный HTML без внешних зависимостей — открывать из репо локально; сайт документации его не рендерит. Это макет структуры, **не дизайн** и не канвас `design-source/` |

Не перенесены (остались в `bbm`, упоминаются в текстах как источники): `interview-log.md`, `transcript-digest*.md`, `review-brief.md`, `review-result.md`, `review-R1-claude-agent.md`, ранний `wireframe.html` сессии 18.08. **Источник текстов Академии** — `bbm`: `outputs/2026-07-24-academy-ds-content-brief.md` (внешний источник, сюда не переезжает).

## Статус

- Discovery **закрыт** — DSP-252 (2026-08-19): все Q и OWD закрыты или переведены в ADR Commit-полосы; ревизия [R2] по двум независимым ревью влита.
- Wireframe **R4 согласован владельцем** — DSP-251 (2026-08-22): правки R3 команды (REQ-116…142) и R4 владельца (лента событий врача, страница события Академии, эволюционная цель) — в макете и в `screens-ru.md`.
- Этап 1 (ниже) **в работе**: топология — [ADR-0015](../../../adr/0015-two-storefront-topology-ru.md) на `main` ([#1432](https://github.com/doctor-school/ds-platform/issues/1432)); модель ядра — ADR-0016 в написании ([#1433](https://github.com/doctor-school/ds-platform/issues/1433)).

## Что должно родиться из пакета — порядок этапов (решение владельца, порядок не менять)

1. **Пересмотр архитектуры под две витрины — ADR.** Топология: один бэкенд / одна БД — предпосылка, **проверить**. Пригодность текущего стека под витрину врача: модуль-путь с видео, экономика очков, верификация документов, НМО, офлайн-события, мобильное приложение на том же бэке. Модель данных ядра: специальности со смежностью, школа / курс / модуль, очки и начисления, эксперт ↔ учётка, инвестор / юнит, клиническая база, верификация. Размещение — `apps/docs/content/adr/NNNN-<slug>.md` (+ `-design.md`), по `.claude/rules/repo-conventions.md` → ADRs & specs.
2. **Дизайн: сверка существующих канвасов `design-source/` с макетом R4** — что остаётся, что переделывается, что рисуется заново. Канвасы рисует владелец (Product Lead); результат сверки фиксируется здесь, в папке эпика.
3. **Функциональная карта экран → REQ → фича** (на базе `screens-ru.md`) и **нарезка фич по штатному конвейеру ADR-0014**: `do-product-discovery` → `author-product-spec` (`brief.md` / `brief-ru.md` эпика + `NNN-product.md` на фичу) → `author-ears-spec` → `open-ears-issues`.
4. **Сборка** — итерации по `do-feature-iteration`, дочерние Issues под #1430.

**Решение владельца по текущим фичам:** главную Академии (**фича 013**, `specs/features/013-academy-home/`) в текущей редакции **не достраивать** до пересмотра структуры (этапы 1–2); **012** (`012-content-taxonomy`) и **014** (`014-event-recordings`) продолжаются как есть. Эпик [`academy-public`](../academy-public/brief-ru.md) остаётся референсом для 012/014.

## Терминология

Во всех документах пакета — строго по [`discovery-glossary-ru.md`](./discovery-glossary-ru.md): роли — **автор**, **соавтор**, **инвестор** (= **партнёр**), **участник**; «создатель», «вкладчик», «спонсор», «рекламодатель» не употребляются. Развилка «инвестор смарт-контракта vs ЦА Академии» (REQ-134) — `TODO(Product Lead)`, см. `screens-ru.md` → R3.
