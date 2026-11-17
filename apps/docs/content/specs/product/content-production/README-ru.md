---
title: "Производство контента DS — пакет переехал в базу знаний BBM"
description: "Указатель: пакет модели процесса и себестоимости производства контента Doctor.School (реестр, трассировка, глоссарий, TO-BE процесс, IDEF0-модель, просмотрщик, ставки, калькулятор) теперь живёт в репозитории bbm-academy-org/bbm-kb; здесь только ссылка."
slug: content-production-readme-ru
parent_issue: https://github.com/doctor-school/ds-platform/issues/2522
status: "Перенесён в bbm-academy-org/bbm-kb (PR #163); единственный мастер — копия в базе знаний"
lang: ru
---

# Производство контента DS — пакет переехал

Пакет целиком перенесён в репозиторий `bbm-academy-org/bbm-kb` ([PR #163](https://github.com/bbm-academy-org/bbm-kb/pull/163)), путь `content/processes/ds-content-production/`. Копия в базе знаний — единственный мастер; здесь остаётся только этот указатель, копий нет.

## Где что теперь

- **Пакет (бывший этот README):** `content/processes/ds-content-production/index.md`, страница — https://kb.bbm.academy/processes/ds-content-production (вход через SSO).
- **Модель, ставки, калькулятор:** каталоги `model/`, `rates/`, `calculator/` рядом с `index.md`.
- **Просмотрщик IDEF0:** код — `components/idef0-viewer/`, страница — https://kb.bbm.academy/processes/ds-content-production/idef0 (уровень диаграммы задаётся в адресе после `#`, например `#A31`).
- **Проверки:** `npm run check:ds-model` и `npm run test:ds-calculator` в CI репозитория bbm-kb.

## Как запустить калькулятор

Из клона bbm-kb: `npx http-server content/processes/ds-content-production -p 8080 -c-1`, затем открыть `/calculator/`.

## Работа продолжается там

Эпик #2522 и его этапы (до #2528 включительно) ведутся по пакету в базе знаний; правки модели, ставок и калькулятора вносятся только в bbm-kb.
