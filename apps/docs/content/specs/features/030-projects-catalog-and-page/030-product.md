---
title: "Feature 030 — Projects: the entity, its admin, the «Все проекты» catalog and the project page (PRD, slice 1)"
description: "Product requirements for slice 1 of feature 030: the project as the single container of Academy work (ADR-0016 §4) — a project is not typed as a school or a podcast, it produces them — managed in the admin; the public «Все проекты» catalog on academy.doctor.school whose cards and scale line read real data; and the project page without its dashboard and its team — hero, results, organizations and the «Войти в проект» entries to the application pages 033/034. Feeds the «Что мы делаем» block of the Academy home 029. Re-specifies the catalog and project-page parts of PRD 015. Feature 030 of the two-site IA epic; source of the 030 slice-1 EARS triplet (ADR-0014)."
slug: two-site-ia-030-projects-catalog-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`030-product-ru.md`](./030-product-ru.md)

> Epic: [Doctor.School relaunch — two-site IA — product brief](../../product/two-site-ia/brief.md) · Scope of record: [functional map](../../product/two-site-ia/functional-map-ru.md) §B row 030, slice 1, and §E (015 → 030) · Domain decision: ADR-0016 §4, OWD-9 · Tracker: [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions» (cascade item 2, owner-approved 2026-10-28) · Prior art: [PRD 015](../015-projects-catalog/015-product.md) (never built). Lead decisions are marked _(lead decision 2026-10-28; owner sees it at Stage A)_.

## Feature summary

A project is how the Academy works: a direction such as «Ортобиология» assembles a team of experts, finds an investor, and produces results — a school, a course, a podcast, an event, a congress. The rule is fixed (REQ-4, V-RV-9, ADR-0016 §4): **the project is the container, the school or the podcast is its output** — not a kind of project. «Кто стоит за брендом» is a project whose output is a podcast; «Ортобиология» is one project whose outputs are a school, a congress and a club.

The platform already keeps project records from feature 012, but they are typed as _school / media / programme_, which contradicts that rule, they cannot say that a project is still being prepared, and the Academy has no public place that lists them. The Academy home 029 needs a «Что мы делаем» block with three project cards and a «Все проекты →» link — and by the owner's principle (#1799) those cards must read real, admin-managed projects, not hand-written copy.

Feature 030 ships in slices. **Slice 1 (this PRD)** delivers: the **project as a container** that states which outputs it produces and at what stage it is (running, «Скоро» — in preparation, or «Завершён»); its **management in the admin**; the public **«Все проекты» catalog** on `academy.doctor.school` — a scale line computed from data and a grid of project cards, the same card feeding the home block; and the **project page without its dashboard and its team** — hero, results, organizations and the «Войти в проект» entries to the application pages 033 and 034. Every card links to its project page. _(lead decision 2026-10-28; owner sees it at Stage A: the canvas draws the card as a link and the page exists in the canvas, so delivering the page in slice 1 avoids a temporary non-clickable card — «без временных костылей».)_ The project's **team block** — the experts with their role in the project and the «Место открыто» card — and every link from the page to an expert's page are a later slice of 030 that ships after the expert pages of 031: slice 1 links to no page that does not exist yet, and the curator is named as plain text. _(lead decision 2026-10-28; owner sees it at Stage A: the canvas «срез 1» hides the team and shows the curator without a link.)_ The **dashboard** — market size, audience, investment, potential (REQ-125) — and the project's cross-cutting number on the page (REQ-89) are the late slice, `blocked_by` **036**. Slice 1 itself is `blocked_by` **032 slice 1**: investor attribution and the choice of a project's organizations read only the 032 organization registry, so slice 1 cannot be finished before that registry exists.

From PRD 015 this slice carries the catalog stories (015 US-1, US-2, US-14, US-15) and the project-page stories without the dashboard, re-stated for the Academy backstage audience; 015's dashboard-related stories go to the late slice.

## User stories

**Catalog:**

- **US-1** — As an **expert or investor visiting the Academy**, I open «Все проекты» and see in one screen everything the Academy runs, is preparing or has completed, so I can judge its scale and find the direction I could join or fund.
- **US-2** — As a **visitor**, each card tells me at a glance what the project is and **what it produces** — «школа · конгресс · клуб», «подкаст» — so I understand that a project is a body of work, not a single course.
- **US-3** — As a **visitor**, a project still being assembled is shown honestly with the stage badge **«Скоро»** and what is happening now (for example «идёт набор команды»), so I see an open door rather than an empty or fake project — an expert sees where to join; a finished project carries the badge **«Завершён»**.
- **US-4** — As a **visitor**, the card shows the **investor organization** that stands behind the project, when that organization allows being named, so I see that real companies already work with the Academy.
- **US-5** — As a **visitor**, the catalog's scale line — «N проектов · M партнёров» and «K эфиров с <год> года» — gives real numbers computed from the platform, never figures someone typed in.
- **US-6** — As a **visitor of the Academy home**, the «Что мы делаем» block shows the same projects as the catalog, and «Все проекты →» leads to the catalog — the home and the catalog never disagree.

**Project page:**

- **US-7** — As a **visitor**, I tap a card and open the **project page**: what the project is, its stage, its curator, how many results and experts it has and since when it runs.
- **US-8** — As a **visitor**, the page lists the project's **results** — school, congress, podcast, club — each leading to where it lives on doctor.school, so I see what the project has actually produced; a project in preparation shows its results honestly as planned.
- **US-9** — As a **visitor**, the page shows the **organizations in the project** — the investor organization when it allows being named, and other organizations by their role (for example a clinical base); a project without an investor shows the free place instead.
- **US-10** — As an **expert** or **investor**, the «Войти в проект» block gives me my way in: «Зайти как эксперт — подать заявку» leads to the application page 033, «Обсудить проект» leads to the investor page 034 — never to a dead end.

**Operator and owner:**

- **US-11** — As an **operator**, I describe a project once — title, short description, cover, the outputs it produces, its stage, its curator, the investor and other organizations — and the catalog card, the home block and the project page reflect it with no page editing.
- **US-12** — As an **operator**, I set **the order** in which projects appear, so the strongest directions lead both the catalog and the home block; the home shows the first three projects of this order, with no separate «show on the home» mark. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-13** — As an **operator**, I keep a project in **draft** until it is ready, **publish** it, and **retire** it; a draft or retired project is absent from the catalog, the home, every count, and its page is not served; a restored project returns as a draft.
- **US-14** — As an **operator**, a project cannot be published while its card would be incomplete (no title, no description, no stated output or stage), so the public catalog never shows a half-filled card. _(agent-proposed — UNCONFIRMED: the exact required set.)_
- **US-15** — As the **product owner**, I know that only platform administrators, signed in to the admin with their second factor, can change projects, and that every change is in the edit history.
- **US-16** — As a **doctor on doctor.school**, I never meet the project as such — I see its results (a school, an event) on my storefront; the project catalog and pages live on the Academy (REQ-51).
- **US-17** — As a **visitor on a phone**, the catalog, the cards and the project page work as well as on desktop.

## Flows

**Browse the catalog (US-1…US-5):**

1. Any visitor — signed in or not — opens «Все проекты» on `academy.doctor.school` (from the Academy navigation or from «Все проекты →» on the home).
2. A header states what projects are and the scale line computed from data: the number of published projects and of partner organizations (counting rule per 032), and the number of broadcasts of the published projects since the year of the first one. _(lead decision 2026-10-28; owner sees it at Stage A: the scale line follows the canvas «6 проектов · 4 партнёра / 98 эфиров с 2024 года».)_
3. Below, the project cards in the operator's order — running and «Скоро» projects first, completed projects after them. Each card follows the canvas card: cover or, without one, a two-letter emblem from the title; the kicker «Проект» with, next to it, the stage badge «Скоро» for a project in preparation or «Завершён» for a completed one (a running project has no badge); title; short description; the outputs line — the outputs the operator declares for the project («школа · конгресс · клуб»), not derived from live content _(lead decision 2026-10-28; owner sees it at Stage A)_ — or, for a project in preparation, what is happening («готовится» / «идёт набор команды»); «Партнёр · <name>» of the investor organization when one is linked and allowed to be shown. The kicker never names an output kind: the canvas demo kickers «Школа» / «Медиа» / «Программа» and the demo count «24 эфира» are replaced by «Проект» and the outputs line under ADR-0016 §4. _(lead decision 2026-10-28; owner sees it at Stage A)_
4. The whole card is a link to the project page.
5. A closing invitation for someone whose direction is missing leads to the real application page (033 slice 1), not to a dead end. _(agent-proposed — UNCONFIRMED: the canvas plate «Предложить школу / Стать партнёром» re-pointed at 033/034 instead of 013's lead form, which the map moves into the shared application queue.)_

**Project page (US-7…US-10):**

1. The visitor opens a project from a card (catalog, home) or by its address; the breadcrumb «Проекты / <project>» returns to the catalog.
2. **Hero**: the kicker «Проект», the stage badge, title, description, «Куратор проекта — <expert>» as plain text with no link, and the counts «N результатов · M экспертов · с <год> года» computed from the project's data. The badge shows the project's public stage: a running project reads «проект идёт»; a project in preparation reads «Скоро» with what is happening now («идёт набор экспертов», «в плане»; US-3) — the canvas badges «набор экспертов» and «в плане» are two such texts of the one «Скоро» stage; a completed project reads «Завершён», which the canvas does not draw. _(lead decision 2026-10-28; owner sees it at Stage A)_
3. **Results**: one card per result the project declares — its kind, title, short description and «на doctor.school ↗» to its storefront page where the result is live — a link to that result's own page, part of the result's content, not site navigation; the owner's rule of one footer link between the sites (#1430) governs navigation and is untouched _(lead decision 2026-10-28; owner sees it at Stage A)_; a project in preparation shows its results as planned; loading and load-error states as drawn.
4. **Organizations**: the investor organization with its logo or, where compliance does not allow a logo, its name as text (032, REQ-70), and other organizations by their role; with no investor, the free place «Стать инвестором проекта» leads to 034.
5. **«Войти в проект»**: the expert card «Место в команде открыто» with «Зайти как эксперт — подать заявку» → 033; the investor card «Обсудить участие в проекте» with one sentence pointing to «Инвесторам» and the button «Обсудить проект» → 034.

**Home block (US-6):**

1. The Academy home 029 shows the first three projects of the same ordered, published set (US-12) as cards of the same design, and «Все проекты →» opens the catalog.
2. Publishing, retiring or reordering a project in the admin changes the home, the catalog and the project page together.

**Operator flow (US-11…US-14):**

1. A platform administrator opens projects in the admin and creates or edits one: title, short description, cover, stage, the outputs it produces (from the platform's list of output kinds — school, course, podcast, event, congress, club …) with each result's title, description and storefront link where it is live, the curator, the linked investor and other organizations with their role from the organization registry (032).
2. They place it in the display order.
3. They publish: the card appears in the catalog and, by its position, on the home; the project page is served.
4. Retiring removes it everywhere at once; restoring returns it as a draft.

**Branches:**

- **A project with no investor yet** → the card shows no attribution rather than an empty slot; the page shows the free investor place.
- **An investor that does not allow being named publicly** (032) → neither the card nor the page shows it.
- **A project with no cover** → the two-letter emblem.
- **A result not yet live on doctor.school** → its card shows no storefront link rather than a dead one.
- **No published projects at all** → the catalog says honestly that projects are being prepared and keeps the invitation to apply; the home block is hidden rather than empty. _(agent-proposed — UNCONFIRMED.)_
- **Existing project records from 012** → they become projects of this model with their links to events, experts and partners kept; their old _school / media / programme_ label is translated into a stated output by the operator, not by a guess. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- A **project is a container, not a type**: a project states the set of outputs it produces (one or many), and neither the catalog nor the page labels a project as «Школа» or «Медиа» as if that were its kind. The list of output kinds is the platform's, maintained in the admin; adding one changes no page. _(agent-proposed — UNCONFIRMED: that the output-kinds list is admin-maintained.)_
- A project has a **public stage** — running, in preparation («Скоро»), or completed («Завершён») — separate from its draft / published / retired life; the card shows it as a badge next to the kicker, the page in its hero. A completed project stays in «Все проекты», ordered after the running and «Скоро» projects. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **«Все проекты»** on `academy.doctor.school` is public, readable with no account, and lists exactly the published projects in the operator's order, each as a card with emblem or cover, kicker and stage badge, title, description, outputs line and the permitted investor attribution.
- The catalog's **scale line is computed** — projects and partners from the published projects and the organization registry, broadcasts and their first year from the published projects' events; nobody types those numbers.
- The **home block «Что мы делаем»** (029) uses the same card and the same ordered set; there is one card design and one source of projects across the Academy.
- **Every card is a link to its project page**, and every published project has a page; no link on the card or the page leads to a missing page.
- The **project page** shows the hero, the results, the organizations and the «Войти в проект» entries to 033 and 034; it shows no dashboard, no project number row, no team block and no backstage block, and no link leads to an expert page.
- Investor and organization attribution comes **only from the organization registry** (032) and respects each organization's public-display permission (REQ-70).
- Only **platform administrators** in an admin session with the second factor (047, 011) manage projects and the output-kinds list; every change is in the edit history (010).
- Projects are an **Academy** surface; the doctor storefront has no projects catalog or project page (REQ-51, ADR-0016 §8).
- The catalog and the project page work fully on mobile and pass the platform's accessibility gate (keyboard-reachable cards and actions).
- Existing project records, their events, experts and partner links are kept (ADR-0016 §9); nothing on `/webinars` or event pages regresses.

## Out of scope

- **The project dashboard** — market size / patients / audience / investment / potential and their manual entry in the admin (REQ-125, owner decision §F-3) — late slice of 030, `blocked_by` **036** (without the ledger the investment figures would be fictitious). The canvas «первоинвестор» smart-contract wording of the investor entry goes with it.
- **The project team block and the expert's role in the project** (REQ-128) — the experts with their role, the «Место открыто» card and the links to expert pages — later slice of 030, after 031 (the expert page and the role as an attribute of the link are 031's).
- **The cross-cutting project number** on the page and through all accounting (REQ-89, OWD-9 accounting side) — 036.
- **The project backstage block «Закулисье»** — expert search, team publications and podcasts of the project — later slice of 030. _(agent-proposed — UNCONFIRMED: after the materials feed 048 can attribute materials to a project.)_
- **Outputs as content** — the school → course → module → lesson hierarchy (023/024), podcasts and clubs as playable content; slice 1 records which outputs a project produces and links to where they already live, it does not deliver them.
- **Event-level partners** (REQ-140) — later slice.
- **Catalog filters and sorting for visitors** (REQ-138) — the catalog is small at launch; facets wait for a later slice.
- **The organization registry itself** — 032 slice 1; this slice is `blocked_by` it (investor attribution and organization selection read only that registry).
- **The application pages the entries lead to** — 033 / 034 slice 1.
- **The production route «методист → продюсер → медэкспертиза»** — 040; project management lives here, not there.

## Open questions

_None blocking slice 1._ The project page in slice 1 without its team, the card design, the scale line, the outputs line, the stage badge, the results' storefront links, the home selection and completed projects are recorded lead decisions above; the owner sees them at Stage A. The items marked _agent-proposed — UNCONFIRMED_ above (the publish-required set, the closing invitation, the empty catalog, the 012 records, the output-kinds list, «Закулисье» after 048) settle at EARS time.

## Approved mockup

_Empty — Stage A pending._ Reference canvases (not yet an approval for this slice): `design-source/academy-projects.dc.html` (the catalog: header with the scale line, `unit-project-card` grid with the stage badge, «Завершён» card after the active ones), `design-source/unit-project-card.dc.html` (the card, optional `stage` badge), `design-source/academy-project.dc.html` (the project page; switch «Объём» = «срез 1» hides the project number, the team, «Закулисье» and the dashboard, and shows the curator without a link) and `design-source/academy-home.dc.html` «Что мы делаем» (three `unit-project-card` cards, outputs line).
