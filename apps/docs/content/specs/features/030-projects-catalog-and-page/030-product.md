---
title: "Feature 030 — Projects: the entity, its admin and the «Все проекты» catalog (PRD, slice 1)"
description: "Product requirements for slice 1 of feature 030: the project as the single container of Academy work (ADR-0016 §4) — a project is not typed as a school or a podcast, it produces them — managed in the admin, and the public «Все проекты» catalog on academy.doctor.school whose cards and scale line read real data. Feeds the «Что мы делаем» block of the Academy home 029. Re-specifies the catalog part of PRD 015. Feature 030 of the two-site IA epic; source of the 030 slice-1 EARS triplet (ADR-0014)."
slug: two-site-ia-030-projects-catalog-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`030-product-ru.md`](./030-product-ru.md)

> Epic: [Doctor.School relaunch — two-site IA — product brief](../../product/two-site-ia/brief.md) · Scope of record: [functional map](../../product/two-site-ia/functional-map-ru.md) §B row 030, slice 1, and §E (015 → 030) · Domain decision: ADR-0016 §4, OWD-9 · Tracker: [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions» (cascade item 2, owner-approved 2026-10-28) · Prior art: [PRD 015](../015-projects-catalog/015-product.md) (never built).

## Feature summary

A project is how the Academy works: a direction such as «Ортобиология» assembles a team of experts, finds an investor, and produces results — a school, a course, a podcast, an event, a congress. The rule is fixed (REQ-4, V-RV-9, ADR-0016 §4): **the project is the container, the school or the podcast is its output** — not a kind of project. «Кто стоит за брендом» is a project whose output is a podcast; «Ортобиология» is one project whose outputs are a school, a congress and a club.

The platform already keeps project records from feature 012, but they are typed as _school / media / programme_, which contradicts that rule, they cannot say that a project is still being prepared, and the Academy has no public place that lists them. The Academy home 029 needs a «Что мы делаем» block with three project cards and a «Все проекты →» link — and by the owner's principle (#1799) those cards must read real, admin-managed projects, not hand-written copy.

Feature 030 ships in two slices. **Slice 1 (this PRD)** delivers: the **project as a container** that states which outputs it produces and at what stage it is (running, or «Скоро» — in preparation); its **management in the admin**; and the public **«Все проекты» catalog** on `academy.doctor.school` — a scale line computed from data and a grid of project cards (emblem or cover, stage, title, short description, the outputs it produces, and the investor organization behind it where its compliance allows). The same card feeds the home block. The **project page with its dashboard** — market size, audience, investment, potential (REQ-125), team, эфиры, the «зайти как эксперт» / «стать первоинвестором» CTAs (REQ-126) — is the late slice, `blocked_by` **036**.

From PRD 015 this slice carries the catalog stories (015 US-1, US-2, US-14, US-15) re-stated for the Academy backstage audience; 015's project-page stories (US-3…US-8, US-12) go to the late slice.

## User stories

- **US-1** — As an **expert or investor visiting the Academy**, I open «Все проекты» and see in one screen everything the Academy runs or is preparing, so I can judge its scale and find the direction I could join or fund.
- **US-2** — As a **visitor**, each card tells me at a glance what the project is and **what it produces** — «школа · конгресс · клуб», «подкаст» — so I understand that a project is a body of work, not a single course.
- **US-3** — As a **visitor**, a project still being assembled is shown honestly as **«Скоро»** with what is happening now (for example «идёт набор команды»), so I see an open door rather than an empty or fake project — an expert sees where to join.
- **US-4** — As a **visitor**, the card shows the **investor organization** that stands behind the project, when that organization allows being named, so I see that real companies already work with the Academy.
- **US-5** — As a **visitor**, the catalog's scale line («N проектов · M партнёров …») gives real numbers computed from the platform, never figures someone typed in.
- **US-6** — As a **visitor of the Academy home**, the «Что мы делаем» block shows the same projects as the catalog, and «Все проекты →» leads to the catalog — the home and the catalog never disagree.
- **US-7** — As an **operator**, I describe a project once — title, short description, cover, the outputs it produces, its stage, the investor organization(s) behind it — and the catalog card and the home block reflect it with no page editing.
- **US-8** — As an **operator**, I set **the order** in which projects appear, so the strongest directions lead both the catalog and the home block. _(agent-proposed — UNCONFIRMED.)_
- **US-9** — As an **operator**, I keep a project in **draft** until it is ready, **publish** it, and **retire** it; a draft or retired project is absent from the catalog, the home and every count, and a restored project returns as a draft.
- **US-10** — As an **operator**, a project cannot be published while its card would be incomplete (no title, no description, no stated output or stage), so the public catalog never shows a half-filled card. _(agent-proposed — UNCONFIRMED: the exact required set.)_
- **US-11** — As the **product owner**, I know that only platform administrators, signed in to the admin with their second factor, can change projects, and that every change is in the edit history.
- **US-12** — As a **doctor on doctor.school**, I never meet the project as such — I see its results (a school, an event) on my storefront; the project catalog lives on the Academy (REQ-51).
- **US-13** — As a **visitor on a phone**, the catalog grid and the cards work as well as on desktop.

## Flows

**Browse the catalog (US-1…US-5):**

1. Any visitor — signed in or not — opens «Все проекты» on `academy.doctor.school` (from the Academy navigation or from «Все проекты →» on the home).
2. A header states what projects are and the scale line computed from data — the number of published projects and of partner organizations (counting rule per 032).
3. Below, the project cards in the operator's order. Each card: cover or, without one, a two-letter emblem from the title; the stage marker («Проект» for a running project, «Скоро» for one in preparation); title; short description; the outputs line («школа · конгресс · клуб») or, for a project in preparation, what is happening («готовится» / «идёт набор команды»); the investor organization's name when one is linked and allowed to be shown.
4. A closing invitation for someone whose direction is missing leads to the real application page (033 slice 1), not to a dead end. _(agent-proposed — UNCONFIRMED: the 015 canvas plate «Предложить школу / Стать партнёром» re-pointed at 033/034 instead of 013's lead form, which the map moves into the shared application queue.)_

**Card target (US-1, branch):** the project page is the late slice. Until it ships, a card is **not a link to a missing page** — see Open questions for what it does instead.

**Home block (US-6):**

1. The Academy home 029 shows the first projects of the same ordered, published set as cards of the same design, and «Все проекты →» opens the catalog.
2. Publishing, retiring or reordering a project in the admin changes the home and the catalog together.

**Operator flow (US-7…US-10):**

1. A platform administrator opens projects in the admin and creates or edits one: title, short description, cover, stage, the outputs it produces (from the platform's list of output kinds — school, course, podcast, event, congress, club …), the linked investor organization(s) from the organization registry (032).
2. They place it in the display order.
3. They publish: the card appears in the catalog and, by its position, on the home.
4. Retiring removes it everywhere at once; restoring returns it as a draft.

**Branches:**

- **A project with no investor yet** → the card shows no attribution rather than an empty slot.
- **An investor that does not allow being named publicly** (032) → the card shows no attribution for it.
- **A project with no cover** → the two-letter emblem.
- **No published projects at all** → the catalog says honestly that projects are being prepared and keeps the invitation to apply; the home block is hidden rather than empty. _(agent-proposed — UNCONFIRMED.)_
- **Existing project records from 012** → they become projects of this model with their links to events, experts and partners kept; their old _school / media / programme_ label is translated into a stated output by the operator, not by a guess. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- A **project is a container, not a type**: a project states the set of outputs it produces (one or many), and the catalog never labels a project as «Школа» or «Медиа» as if that were its kind. The list of output kinds is the platform's, maintained in the admin; adding one changes no page. _(agent-proposed — UNCONFIRMED: that the output-kinds list is admin-maintained.)_
- A project has a **public stage** — running, or in preparation («Скоро») — separate from its draft / published / retired life; the card shows it.
- **«Все проекты»** on `academy.doctor.school` is public, readable with no account, and lists exactly the published projects in the operator's order, each as a card with emblem or cover, stage, title, description, outputs line and the permitted investor attribution.
- The catalog's **scale line is computed** from published projects and the organization registry; nobody types those numbers.
- The **home block «Что мы делаем»** (029) uses the same card and the same ordered set; there is one card design and one source of projects across the Academy.
- **No card leads to a missing page**; the late-slice project page does not exist yet and the catalog does not pretend it does.
- Investor attribution comes **only from the organization registry** (032) and respects each organization's public-display permission (REQ-70).
- Only **platform administrators** in an admin session with the second factor (047, 011) manage projects and the output-kinds list; every change is in the edit history (010).
- Projects are an **Academy** surface; the doctor storefront has no projects catalog (REQ-51, ADR-0016 §8).
- The catalog works fully on mobile and passes the platform's accessibility gate (keyboard-reachable cards and actions).
- Existing project records, their events, experts and partner links are kept (ADR-0016 §9); nothing on `/webinars` or event pages regresses.

## Out of scope

- **The project page** (`#a-project`) — header, dashboard with market size / patients / audience / investment / potential and their manual entry in the admin (REQ-125, owner decision §F-3), team, partner block, the project's эфиры, CTAs «зайти как эксперт» / «стать первоинвестором» (REQ-126) — late slice of 030, `blocked_by` **036** (without the ledger the investment figures would be fictitious).
- **Outputs as content** — the school → course → module → lesson hierarchy (023/024), podcasts and clubs as playable content; slice 1 records which outputs a project produces, it does not deliver them.
- **The cross-cutting project number through all accounting** (REQ-89, OWD-9 accounting side) — 036.
- **The expert team on a project and the expert's role in it** (REQ-128) — 031 and the late slice.
- **Event-level partners** (REQ-140) — later slice.
- **Catalog filters and sorting for visitors** (REQ-138) — the catalog is small at launch; facets wait for a later slice.
- **The organization registry itself** — 032 slice 1.
- **The application pages the invitation leads to** — 033 / 034 slice 1.
- **The production route «методист → продюсер → медэкспертиза»** — 040; project management lives here, not there.

## Open questions

- **Where does a card lead before the project page exists? (owner)** The project page is the late slice. Options: (a) the card is not clickable until the page ships; (b) the card opens the application page with the project preselected, inviting the visitor to join it; (c) a project page without the dashboard is pulled into slice 1, and the dashboard is added when 036 is ready.
- **What does the outputs line show? (owner)** The outputs the project _plans_ to produce, as stated by the operator, or only outputs that already have live content on the platform? The canvas «Ортобиология — школа · конгресс · клуб» reads as the stated set.
- **Which projects appear on the home? (owner)** The lead proposes the first three of the operator's order (US-8). Alternatively, an explicit «show on the home» mark per project.
- **Stages beyond running and «Скоро». (owner)** Is a finished project shown (for example a past congress project) and with what marker, or does a finished project leave the catalog?

## Approved mockup

_Empty — Stage A pending._ Reference canvases (not yet an approval for this slice): `design-source/academy-home.dc.html` «Что мы делаем» (three `unit-project-card` cards: «Проект» / «Скоро», emblem, outputs line) and `design-source/academy-projects.dc.html` (the 015 catalog canvas, verdict «остаётся» in the functional map §A).
