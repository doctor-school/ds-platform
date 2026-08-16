---
title: "Feature 015 — Projects catalog & the project page (PRD)"
description: "Product requirements for making the academy's projects a browsable surface: a public `/projects` catalog of project cards with a partner-facing CTA plate, and a `/projects/[slug]` page carrying the project's poster header, its industry partner, its expert team, and its own Будущие / Прошедшие эфиры rendered by the shared event-list unit delivered in 014. Feature 015 of the Academy public surface epic; closes 013's tracked deferral for the projects entry point; source of the 015 EARS triplet (ADR-0014)."
slug: academy-public-015-projects-catalog-product
epic: ../../product/academy-public/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`015-product-ru.md`](./015-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · Fourth on the critical path (after 012, 013 and 014) · Consumes the event-list unit and its filter capability delivered by 014 ready-made; closes the tracked deferral 013 opened for the `/projects` entry point.

## Feature summary

A project is how Doctor.School actually works — a school, a media strand, or a programme with a standing expert team, a recurring schedule of эфиры, and usually an industry partner funding it. Today none of that is visible: a doctor meets the academy one broadcast at a time, and a partner has no way to see what an ongoing direction looks like before deciding to fund one. Feature 013 already speaks about projects on the landing, but its links point at a surface that does not exist — an accepted, tracked deferral that this feature closes.

Feature 015 gives projects **two public surfaces**. `/projects` is a **catalog**: a poster header stating the scale of the academy («N проектов · M партнёров», эфиры since the founding year), a grid of **project cards** — kind, title, short description, an эфиры/выпуски/модули count, and the partner attribution — and a closing **CTA plate** for someone whose direction is missing («Предложить школу» / «Стать партнёром»), which routes to the landing's lead form rather than growing a second one.

`/projects/[slug]` is the **project page**: a blue poster header with breadcrumbs, kind kicker, title, description, the curator named as a link, and a stat row; the **industry partner** presented as a standalone block that states plainly that the partner funds the эфиры and does not choose topics or speakers; the **expert team** as a grid of the same expert-card unit 013 and 016 use; and the project's **own эфиры** split into **Будущие** and **Прошедшие** tabs, rendered by the shared event-list unit — the one that gained its filter capability in 014, consumed here ready-made rather than rebuilt. When a project has no upcoming эфиры, the page says so honestly and sends the doctor to the recordings instead of showing an empty list. A closing dual **CTA band** repeats the epic's dual-audience logic on the page: the nearest эфир for doctors, partnership for the industry.

The feature adds **no new domain entity**: everything on both surfaces reads the 012 taxonomy — `projects`, `project_partners`, `event_projects`, `experts` — and everything about playback and past-event behavior belongs to 014. It does own one surface-specific batched catalog/page read model over those rows, because card counts, primary-partner attribution and an enriched team must not be assembled through one 012 relationship call per card.

## User stories

- **US-1** — As a **guest doctor**, I open `/projects` and see, in one screen, what the academy actually runs — its schools, media and programmes — so I can judge the scale and find my own field without registering.
- **US-2** — As a **doctor**, each project card tells me at a glance what the project is, what kind it is, how much of it there is, and who funds it — enough to decide whether to open it.
- **US-3** — As a **doctor**, I open a project and understand within the first screen what it is about, who curates it, and how long it has been running.
- **US-4** — As a **doctor**, I see the project's **upcoming эфиры** and register for one without leaving the project's context.
- **US-5** — As a **doctor**, I see the project's **past эфиры** and reach their recordings — a project is a body of content, not only a schedule.
- **US-6** — As a **doctor**, when a project has no upcoming эфиры the page tells me so plainly and points me to its recordings, instead of showing me an empty list and no way forward.
- **US-7** — As a **doctor**, I see the project's **expert team** with names, roles and credentials, so I know who I would be learning from.
- **US-8** — As a **doctor**, the project page states plainly that the industry partner funds the эфиры but does not choose the topics or the speakers, so I can trust that the content is not an advertisement.
- **US-9** — As a **pharma partner**, I see which company already stands behind a direction and what "being a partner" looks like in practice — a real page I can show internally when arguing for a budget.
- **US-10** — As a **pharma partner**, from the catalog or from a project I reach the partnership request in one step, with the project I was looking at carried into the conversation.
- **US-11** — As a **visitor with a niche specialty**, when nothing in the catalog matches me I still have an action — proposing a school — instead of a dead end.
- **US-12** — As a **doctor**, the same event card, list and pagination behave here exactly as on `/webinars`, so I am never re-learning an interface between sections.
- **US-13** — As a **visitor arriving from the landing**, the projects entry point on `/` leads to a real catalog — the sequencing deferral 013 declared is closed rather than permanent.
- **US-14** — As an **operator**, I describe a project once — kind, title, description, cover, curator, partner, team — and both the catalog and the project page reflect it, with no page editing.
- **US-15** — As a **visitor on a phone**, the catalog grid, the project header, the team grid and the эфиры tabs all work as well as on desktop.
- **US-16** — As a **product owner**, every published event becomes reachable through at least one project, which is the epic's "content becomes browsable" metric made concrete.

## Flows

**Browse the catalog (US-1, US-2, US-11):**

1. Any visitor — signed in or not — opens `/projects` → the poster header states what projects are and the academy's scale; below it a grid of project cards.
2. Each card carries **kind** (Школа / Медиа / Программа), title, a short description, a content count («24 эфира», «14 выпусков», «6 модулей») and, when one exists, the **partner attribution** («Партнёр · <name>»); a project with no partner simply shows no attribution rather than an empty slot.
3. The visitor taps a card → `/projects/[slug]`.
4. Below the grid the **CTA plate** — «Предложить школу» / «Стать партнёром» — leads to the landing's lead form (feature 013); 015 grows no second form.

**Open a project (US-3, US-4, US-5, US-7, US-8):**

1. Visitor lands on `/projects/[slug]` → breadcrumbs back to the catalog, kind kicker, title, description, the **curator named as a link to their expert page**, and a stat row (эфиры count · experts count · running since).
2. The **partner block** follows the header as a standalone bordered block: partner name, the plain statement that it funds the эфиры and does not select topics or speakers, and a «Стать партнёром →» link.
3. The **team** section renders the project's experts as a grid of expert cards (name, role, credentials, organisation, per-project meta such as «Куратор · 12 эфиров»).
4. The **эфиры** section carries two tabs — **Будущие** and **Прошедшие**, each with its count — rendered by the shared event-list unit; the Прошедшие tab paginates. A «Все эфиры платформы →» link leads to `/webinars`.
5. Selecting an event opens `/webinars/[slug]` — pre-live announcement + registration (004/005) or the post-live state with the recording (014).
6. The closing **CTA band** addresses both audiences: the nearest эфир for the doctor, partnership for the industry.

**A project with no upcoming эфиры (US-6):**

1. The Будущие tab has nothing to show.
2. Instead of an empty list, the page states plainly that no эфиры are scheduled yet and offers a direct action — «Смотреть записи» — which switches to the Прошедшие tab.
3. The state is derived from the data; the operator edits nothing to produce it.

**Partner path (US-9, US-10):**

1. A partner lead reaches the catalog or a project page and reads the partner block as a concrete example of what sponsorship looks like.
2. From either the catalog CTA plate or the project's CTA band they reach the landing's lead form.
3. The project they came from is carried into the request, so the commercial team knows which direction the interest is about. _(agent-proposed — UNCONFIRMED: the canvas states «Форма уже знает, о каком проекте вы пишете», which the lead reads as a pre-filled project context on the lead; the owner approved neither the mechanism nor the `leads` field it implies.)_

**Operator flow (US-14):**

1. Operator creates or edits a project in the admin (feature 012): kind, title, description, cover, curator, team, partner.
2. Both public surfaces derive from that record — card, header, team and partner block alike.
3. An event linked to the project through `event_projects` appears in the project's эфиры tabs by itself; an event belonging to several projects appears on each of them.

**Branches:**

- **A project with no partner** → the card shows no partner attribution and the page renders no partner block; the CTA band's partner side stays, since the point is to attract one.
- **A project with no events at all** (freshly created) → both tabs are empty; the honest empty state covers Будущие and the Прошедшие tab is not offered as an empty list. _(agent-proposed — UNCONFIRMED.)_
- **A project with no team yet** → the team section is omitted rather than rendered empty. _(agent-proposed — UNCONFIRMED.)_
- **A draft or retired project** → absent from both the catalog and direct-link public detail. Restore returns the same retained project to `draft`; an operator must publish it again before either surface returns.
- **An expert card opened before 016 ships** → see the sequencing note in the acceptance criteria; the team is never rendered as dead links.

## Product acceptance criteria

- `/projects` is a **public catalog** readable with no account, listing the academy's published projects as cards carrying kind, title, description, a content count and the partner attribution when one exists.
- `/projects/[slug]` is a **public project page** carrying the poster header (kind, title, description, curator as a link, stat row), the partner block, the expert team, the project's эфиры, and the closing dual CTA band.
- The project's эфиры render in **Будущие / Прошедшие tabs with counts**, and are delivered by the **shared event-list unit** (epic decision #7) — the unit 014 extended, consumed ready-made. 015 builds no project-only listing, card or pagination.
- A project with **no upcoming эфиры** shows an explicit, honest state with a direct action to its recordings — never an empty list and never a blank section.
- The **partner block states the editorial boundary in plain words**: the partner funds the эфиры and does not select topics or speakers. This is a trust claim on a medical-education surface, not decoration — it is present wherever a partner is shown on the project page.
- **Both partner-facing CTAs route to the landing's single lead form** (feature 013). 015 introduces no second lead form and no second submission path.
- The **catalog and the project page read the 012 taxonomy** — `projects`, `project_partners`, `event_projects`, `experts` and their joins. `projects.kind` is exactly `school | media | program`; the displayed curator is the one active eligible `project_experts.role = curator` relation; a project may have many partner links but only its optional active `project_partners.is_primary` relation supplies the singular card/page partner. 015 models no new entity and re-types no free-text.
- 015 owns one exact **batched project-catalog/page projection** over that taxonomy. Its future EARS spec must pin the card/page DTO and bounded-SQL query for the kind-specific content count, nullable primary partner, curator and enriched team (credentials and affiliation included); rendering must not fetch the full catalog or issue N+1 HTTP/SQL relationship reads.
- Draft, retired and unknown projects are indistinguishable on both public surfaces. Restoring a retained project returns it to `draft`, so republishing is deliberate rather than an automatic return to the catalog or direct-link page.
- **013's tracked deferral is closed**: the landing's projects entry point resolves to this catalog, and nothing in 013 keeps a placeholder for it.
- The **expert team uses the same expert-card unit** as the landing and 016, and each card links to that expert's page. **Until 016 ships**, the team renders as cards without a live target rather than as links to a 404 — the deferral 013 recorded, mirrored here for the expert direction, closing when 016 lands. _(agent-proposed — UNCONFIRMED: the epic records the 015/016 sequencing but not this concrete resolution.)_
- An event belonging to **several projects** appears under each of them; nothing about the event page changes because it was reached from a project.
- Both surfaces work fully on **mobile** — the card grid, the poster header, the team grid, the tabs and the pagination.
- Both surfaces meet the platform's accessibility bar for a public surface — the same `playwright-axe` gate every user-facing surface passes, including keyboard-reachable cards, tabs and CTAs and a tab control that announces its selected state.
- Nothing in `/webinars`, the event page or «Мои события» regresses: 015 consumes shared units, it does not modify them.

## Out of scope

- **The experts catalog and expert pages** — feature 016. 015 renders expert cards and links to them; it does not build those surfaces.
- **The taxonomy entities, admin CRUD and base entity/relationship read API** — feature 012, a hard dependency, not parallel work. The aggregate catalog/page projection named above belongs to 015 and is implemented with these public surfaces.
- **The event-list unit's filter facets and the «Прошедшие» tab mechanics** — delivered in 014; 015 consumes them. If a project page needs its own facets at all, that is a refinement of the shared unit, not a 015 deliverable.
- **The lead form itself** — feature 013. 015 only routes to it.
- **Recordings, the player and the login gate** — feature 014.
- **Project-level analytics or partner reporting** (impressions, attendance per project, sponsor dashboards).
- **Following / subscribing to a project**, notifications about its new эфиры, and any personalised project feed.
- **Non-event project content as a playable unit** — a media project's episodes or a programme's modules as first-class content records with their own player. The catalog names such projects and counts their units; delivering them is not in this feature (see Open questions).
- **Offline / congress project formats** and paid tiers — explicitly out of the epic.
- **Final marketing copy and final imagery** (project covers, partner logos) — an owner editorial pass and an asset-delivery matter respectively.

## Open questions

- **Media / Programme content at launch.** `projects.kind` is already the exact 012 enum `school | media | program`. What content sits behind Медиа and Программа projects at launch—or whether they are catalog entries pointing elsewhere—remains unresolved.
- **Catalog scale and ordering.** The canvas shows six projects in one grid with no pagination, sorting or filtering. What the default order is (activity, size, manual weight) and at what count the catalog needs paging or a filter is unresolved — the shipping catalog is small, so this may stay a deliberate non-feature.
- **Carrying the project into the lead.** Whether the partnership request records which project it came from (the canvas asserts the form «уже знает, о каком проекте вы пишете»), which implies a field on `leads` that 013 did not specify.
- **The header stat row's source.** «24 эфира · 6 экспертов · с 2024 года» — whether these are derived counts or operator-entered figures, and what the "running since" date is derived from.
- **The partner-independence wording.** The claim itself is treated as fixed above; its exact phrasing is owner copy, and whether it also appears on the catalog card (where the canvas shows only the attribution) is open.
- **Multi-project events in the counts.** Whether an event shared by two projects counts fully in both stat rows or is attributed to a primary project.

## Approved mockup

**Stage A resolved 2026-08-13** for both 015 surfaces. The owner finished these page designs themselves in the claude.ai Design app (project «Doctor.School визуальный язык», `8cc2f39a`) and handed the project over for page-by-page acceptance — the epic #1240 process agreement: a page is accepted by being finished on the canvas, and acceptance is recorded as vendoring plus a Stage-A record in its feature's PRD. Both canvases are the approved mockups and the composition SoT for this feature; every canvas-carried resolution is read off the vendored copy, never off this PRD's prose.

**The catalog** — canvas **«Проекты»**, vendored verbatim at [`design-source/projects-listing.dc.html`](../../../../../../design-source/projects-listing.dc.html) (pulled 2026-08-13 via DesignSync from project `8cc2f39a`, canvas file «Проекты.dc.html»). This canvas carries **no composition fork** — a single composition, recorded as such: blue poster header with the scale line, a `repeat(auto-fill,minmax(min(300px,100%),1fr))` card grid, and the closing CTA plate whose both actions point at the landing's lead form.

**The card** — canvas **«ПроектКарточка»**, vendored verbatim at [`design-source/project-card.dc.html`](../../../../../../design-source/project-card.dc.html) (`dc-import`ed by the catalog canvas, vendored with it per the vendor-every-rendered-canvas rule). It is a reusable unit with injected props (`kind`, `title`, `description`, `count`, `partnerName`, `emblem`, `href`, `dark`); the partner attribution is conditional on `partnerName` being non-empty, and the cover plate falls back to a two-letter emblem derived from the title.

**The project page** — canvas **«Проект»**, vendored verbatim at [`design-source/project-page.dc.html`](../../../../../../design-source/project-page.dc.html) (canvas file «Проект.dc.html»). It carries **two composition forks as canvas props, and the canvas default of each is the operative Stage-A pick** _(carried by the canvas default, matching the 013/014 pattern — no separate owner verbatim quote exists for these forks)_:

- **`partner` enum `a | b`, canvas default `b` — operative pick:** the partner is a **standalone bordered block placed after the poster header**, with the funding statement and the «Стать партнёром →» link. The alternative **`a` — an outlined partner plate inside the blue hero — is recorded as the rejected variant**; it remains in the canvas as the switchable fork, not as an open question.
- **`team` enum `before | after`, canvas default `before` — operative pick:** the **expert team is placed before the эфиры list**, so a visitor meets the people before the schedule. `after` is the recorded alternative.

The canvas additionally carries the page's **state** fork `emptyUpcoming` (boolean, default `false`) — the honest "no upcoming эфиры yet" plate with its «Смотреть записи» action — and the эфиры section's **Будущие · N / Прошедшие · N** tab pair with pagination on the past tab, which is the shared event-list unit's behavior as 014 delivers it. The bottom-left composition switcher in the canvas is a design-time control, not a product surface.
