---
"@ds/api": major
"@ds/schemas": major
"@ds/api-client": major
"@ds/db": major
"@ds/admin": minor
---

Projects catalog (030, #3503): migration 0055 absorbs the 012 projects — every project keeps its id, slug, state, version and links, gets the stage «Проект идёт», keeps its former kind only as the read-only `legacyKind` hint, and has no results; every organisation link gets the investor role. The project form drops the kind and gains the stage («Проект идёт» / «Скоро» / «Завершён», «Скоро» by default) with «Что происходит сейчас» required for «Скоро»; `GET/PUT /v1/admin/projects/:id/results` read and replace a project's ordered results (0–20, each with an output kind, a title, an optional description and an optional doctor-storefront link); `/v1/admin/project-output-kinds` lists the «Виды результатов» (Школа, Курс, Подкаст, Событие, Конгресс, Клуб) with result counts, adds, renames, retires (refused while a draft or published project's result holds the kind) and restores them. Publishing a project now reports every missing item together — title, description, at least one result, the stage note of «Скоро» and the curator — as `409 PUBLISH_REQUIREMENTS_NOT_MET` field errors. The public project summary no longer carries `kind`.

The admin gains the «Результаты» tab on a project (ordered rows, move up/down, saved as one set), the «Виды результатов» section, a «Стадия» column with «Не на сайте: нет результатов» in the project list, and a refused «Опубликовать» that lists each missing item with a control opening the tab that fixes it.

Deploy window: between migration 0055 and the new api container, the still-running old api reads the renamed `projects.kind` column, so admin project reads and the public project relationship routes fail until the new api is up; the hot public event and Academy paths select explicit project columns and are unaffected.
