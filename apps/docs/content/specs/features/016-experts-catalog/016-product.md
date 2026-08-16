---
title: "Feature 016 — Experts catalog & the expert page (PRD)"
description: "Product requirements for making the academy's expert bench browsable: an `/experts` catalog with name search and a single-select project filter over a grid of the shared expert card, an honest empty state and a «Стать экспертом» CTA plate, plus `/experts/[slug]` — the expert page with a bio hero, «Где участвует» project rows, Будущие/Прошедшие event tabs rendered by the shared event-list unit, and optional podcast episodes. Last on the Academy public surface critical path; closes 013's tracked deferral for the experts entry point; source of the 016 EARS triplet (ADR-0014)."
slug: academy-public-016-experts-catalog-product
epic: ../../product/academy-public/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`016-product-ru.md`](./016-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · **Last on the critical path** (012 → 013 → 014 → 015 → 016). 016 consumes the event-list unit with its filter capability **ready-made from 014** and the project pages **from 015** — it adds no listing mechanics of its own.

## Feature summary

The academy's credibility is its people. Today an expert exists only as a name printed on an event — free text on a card, unlinkable, uncountable. A doctor who liked how someone taught cannot find their other эфиры; a partner evaluating sponsorship cannot see the bench they would be funding; the academy cannot show that the same practising physicians come back season after season.

Feature 016 gives the expert bench **two public surfaces**. `/experts` is the catalog: a grid of expert cards over the whole roster, with **name search** and a **single-select «Проект» chip filter** — deliberately light, because the bench is browsable at a glance and does not need the full facet machinery of the archive. It states honestly how many of how many are shown, says something useful when nothing matches (and offers a reset rather than a dead end), and closes on a **«Стать экспертом» CTA plate** for a doctor who wants to teach rather than watch.

`/experts/[slug]` is the person. A bio hero carries the photo, name, role, credentials and a stat line; **«Где участвует»** lists the projects they take part in as links; and their events sit below in **Будущие / Прошедшие tabs rendered by the shared event-list unit** — so a past эфир leads straight into its recording (feature 014) and an upcoming one into registration (feature 005). When the academy's own media features the person, **podcast episodes** render as an extra section; when they do not, the section simply is not there.

016 also **closes the loop the epic opened**: the free-text speaker line on an event page becomes a real link to a real person, and the `/experts` entry point that 013 had to defer — the landing and header nav link to a section that does not exist yet — becomes a genuine destination. That deferral is 013's, and it is **discharged here**.

## User stories

- **US-1** — As a **guest doctor**, I open `/experts` and see the academy's whole expert bench at once, so I can judge who teaches here before I register for anything.
- **US-2** — As a **doctor**, I find a specific expert by typing their name, without scrolling the whole roster or knowing which project they belong to.
- **US-3** — As a **doctor**, I narrow the catalog to a single project, so «who teaches in this school» is one click rather than a reading exercise.
- **US-4** — As a **doctor**, the catalog tells me how many experts I am looking at out of how many exist, so a filtered view never silently reads as the whole bench.
- **US-5** — As a **doctor whose search matches nobody**, I get a plain explanation of why the page is empty and a one-click way back to the full list — never a blank screen I have to escape by hand.
- **US-6** — As a **doctor**, I open an expert's page and understand within seconds who this person is professionally — role, credentials, affiliation, and what they do at the academy.
- **US-7** — As a **doctor**, the expert's page shows which projects they take part in, and each one takes me to that project, so a person is a way into the academy's programmes and not a dead end.
- **US-8** — As a **doctor**, I see the expert's **upcoming** эфиры on their page and can register for one directly from there.
- **US-9** — As a **doctor**, I see the expert's **past** эфиры on their page and reach the recording of any of them, so liking one lecture leads me to everything else that person has done.
- **US-10** — As a **doctor**, when the expert appears in the academy's podcast, their episodes are listed on the page; when they do not, nothing empty or promissory is shown.
- **US-11** — As a **doctor on an event page**, the speakers are real links that take me to their expert pages — a name I noticed during an эфир is one tap from everything else they teach.
- **US-12** — As a **doctor who teaches**, the catalog gives me an obvious way to propose myself as an expert, so the bench can grow from the audience it serves.
- **US-13** — As a **pharma partner**, the experts catalog shows me the scale and seniority of the bench behind the academy, which is a large part of what I am evaluating as a sponsor.
- **US-14** — As a **visitor on a phone**, the catalog, the search, the project filter and the expert page all work as well as on desktop, since a large share of doctors arrive from mobile.
- **US-15** — As an **operator**, an expert I describe once in the taxonomy (012) appears in the catalog and on their own page with their projects and events assembled automatically — I never maintain a page per person.
- **US-16** — As a **product owner**, the expert card and the event list on these pages are the **shared design-system units**, so the catalog, the home page, the project page and the event page all show a person the same way and change in one place.

## Flows

**Browse the bench (US-1, US-2, US-3, US-4, US-5):**

1. A visitor — signed in or not — opens `/experts` → poster header, then the search input and the «Проект» chip row, then the card grid of the whole roster.
2. The visitor types part of a name → the grid narrows as they type; the count note states «Показаны N из M». _(Live narrowing as-you-type is carried by the canvas; whether the query persists in the URL is an open question below.)_
3. The visitor picks a project chip — **single-select, «Все» is the default** — and the grid narrows to that project's experts; search and chip combine (AND).
4. Nothing matches → the dashed empty state explains which case it is («по запросу … никого не нашли» versus «в этом проекте пока нет экспертов») and offers **«Сбросить поиск и фильтры»**, which restores the full grid.
5. The visitor clicks a card → `/experts/[slug]`.
6. The page closes on the **«Хотите вести эфиры?» CTA plate** with «Стать экспертом» (US-12).

**Read a person (US-6, US-7):**

1. The visitor opens `/experts/[slug]` → breadcrumbs, then the bio hero: photo, name, role, credentials, affiliation, short bio and a stat line (эфиры, projects).
2. **«Где участвует»** renders the expert's projects as link rows; past four entries an expand control reveals the rest rather than stretching the page.
3. Each row leads to that project's page (feature 015).

**Follow their events (US-8, US-9):**

1. Below the projects, the expert's events render in **Будущие / Прошедшие** tabs.
2. **Будущие** → an upcoming эфир opens `/webinars/[slug]` in its pre-live state, where registration (feature 005) takes over.
3. **Прошедшие** → a finished эфир opens the same route in its **post-live state** (feature 014): the player for a signed-in doctor, the publicly readable page plus the sign-in invitation for a guest.
4. A tab with nothing in it shows the unit's empty state; the past tab pages through its list rather than dumping the full history.
5. Both tabs, the cards, the empty state and the pager are the **shared event-list unit** (epic decision #7) — 016 consumes it, it does not re-implement it.

**Podcast episodes (US-10):**

1. The expert features in academy media → an episode-row section renders after the events.
2. They do not → the section is absent entirely; no empty block, no «скоро» placeholder.

**Arriving from elsewhere (US-11, and 013's deferral):**

1. On an event page, a speaker card links to `/experts/[slug]` (the free-text speaker fallback from 012 stays unlinked — a name without an entity is not a broken link).
2. The header nav «Эксперты» and the landing's experts entry point resolve to the real catalog — the 013 deferral is discharged.

**Branches:**

- **An expert with no events and no projects** may still be published → the page renders the bio, omits «Где участвует», and both event tabs show their honest empty state; zero relationships never block publication or catalog visibility.
- **A draft or retired expert** → absent from both `/experts` and direct-link detail. On an event, an explicit mapped legacy speaker row becomes the plain-text fallback again instead of leaving a broken expert link. Restore returns the expert to `draft`; republish is required.
- **A very large roster** → the canvas grid has no pagination (the bench is small by design); at what size the catalog needs paging is unresolved. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- `/experts` is **publicly readable with zero authentication** and lists published, non-retired academy experts as a card grid — no account, no gate. Zero project/event relationships do not exclude an otherwise publishable expert.
- The catalog carries **name search** and a **single-select project filter** whose default is «Все»; the two combine, and both are reachable and usable on mobile.
- The catalog states **how many experts are shown out of how many exist**, so a narrowed view is never mistakable for the full bench.
- When search or filter yields nothing, the page shows an **honest, case-specific empty state** with a working reset to the full list — never a blank grid and never a dev placeholder.
- The catalog closes on a **«Стать экспертом» CTA** that leads somewhere real (its target is an open question below, not an optional element).
- `/experts/[slug]` is **publicly readable** for a published, non-retired expert and presents the person: optional photo, name, role, credentials, affiliation, bio and a stat line. When no photo exists, both the shared card and page hero render the same honest initials fallback; photo absence never blocks publication.
- The expert page lists the **projects the expert participates in** as links to those projects' pages (feature 015), with an expand affordance rather than an unbounded list.
- The expert page lists the expert's events in **Будущие / Прошедшие tabs**, upcoming leading to the pre-live event page and past leading to the **post-live state with its recording** (feature 014).
- **Podcast episodes render only when they exist**; their absence removes the section rather than showing an empty one.
- The event tabs, cards, empty state and pager are the **shared event-list unit**, and the cards in the catalog and on other surfaces are the **shared expert card** — 016 adds no private copy of either. The filter capability it needs was delivered into the unit by 014; 016 consumes it.
- **Speaker references on event pages link to expert pages** only while the linked expert is published and non-retired; a legacy free-text speaker stays plain text, and retiring an explicitly matched expert reveals that retained legacy fallback again rather than leaving a dead link.
- **013's tracked deferral is closed here**: the landing's and the header nav's «Эксперты» entry point resolves to the real catalog, and 013's interim treatment is removed rather than left in place.
- Experts, their projects, their roles on events and their events all come from the **012 taxonomy** — 016 reads that data and models nothing new.
- An expert slug is generated when omitted, may be edited only before first publication, and is immutable after first publication; renaming the expert never changes the public route.
- Both surfaces work on mobile — the search, the chip row, the grid, the bio hero, the project rows and the tabs alike.
- Both surfaces meet the platform's accessibility bar for a public surface — the same `playwright-axe` gate: the search input labelled, the chips real controls with a visible state, the cards real links, the tabs keyboard-operable.
- Nothing that 014 and 015 shipped regresses — 016 consumes their units and pages, it does not modify them.

## Out of scope

- **The taxonomy itself** — `experts`, the `event_experts` join carrying the per-event role, and the admin CRUD behind them are feature 012, a hard dependency of this one.
- **The event-list unit's filter/tab machinery** — delivered by 014; 016 consumes it ready-made and adds no listing mechanics.
- **The project pages** the «Где участвует» rows link to — feature 015.
- **Recordings and the post-live page state** the «Прошедшие» tab leads into — feature 014.
- **An expert self-service profile** — experts do not log in to edit their own page here; the operator maintains the entity (012).
- **A lead lifecycle for «Стать экспертом»** submissions (CRM, statuses, follow-up) — beyond where the CTA leads, nothing about processing an expert application is specified here.
- **Facet filtering by topic or specialty** on `/experts`, and sorting controls — the canvas resolves the catalog as search + one project filter.
- **A podcast surface of its own** (an episode page, an episodes catalog) — 016 lists episodes on an expert's page and nothing more.
- **Analytics** on catalog usage or expert-page traffic, and any reporting to partners.

## Open questions

- **Where «Стать экспертом» leads.** The canvas points it at the landing's partner form anchor (`Главная.dc.html#partner-form`), which is the **pharma-partner** lead form — a doctor proposing themselves as a speaker is a different intent and would land in «DS Лиды» as a partner request. Whether this is deliberate reuse, a separate form, or a mailto/contact route is an owner call before implementation. _(Lead-flagged; the canvas default is not read as a product decision here.)_
- **URL persistence of the catalog state.** Whether the search query and the selected project survive in the URL (shareable, back-button-safe) is not carried by the canvas — the same question 014 left open for the «Прошедшие» tab, and it should be answered the same way for both.
- **Ordering of the catalog grid.** Alphabetical, by event count, or curated — the canvas fixes the composition, not the order. _(agent-proposed — UNCONFIRMED.)_
- **Catalog scale.** The canvas grid has no pagination — at what roster size the catalog needs paging or grouping, if ever.
- **The stat line's content.** The canvas hero shows counts (эфиры, projects); whether those are lifetime totals, published-only, or something the operator sets is unresolved.

## Approved mockup

**Stage A resolved 2026-08-13** for both surfaces of this feature. The owner finished these page designs themselves in the claude.ai Design app (project «Doctor.School визуальный язык», `8cc2f39a`) from the experts section of the design brief ([`design-brief-academy-public-ru.md`](../../product/academy-public/design-brief-academy-public-ru.md)) and handed the project over for page-by-page acceptance — the epic #1240 process agreement: **a page is accepted by vendoring it plus recording its Stage-A picks in its feature's PRD**, and the owner accepted each page on canvas acceptance. Every canvas-carried resolution is read off the vendored copy, never off this PRD's prose.

**The catalog** — canvas **«Эксперты»**, **vendored verbatim** at [`design-source/experts-listing.dc.html`](../../../../../../design-source/experts-listing.dc.html) (pulled 2026-08-13 via DesignSync, canvas file «Эксперты.dc.html»). It carries **no composition fork — a single composition**, recorded as such: blue poster header («Врачи, которые ведут эфиры» + a stat block), the name-search input and the single-select «Проект» chip row («Все» default), the card grid `repeat(auto-fill, minmax(min(240px,100%),1fr))` rendering `ЭкспертКарточка` via `dc-import`, the count note «Показаны N из M», the dashed two-case empty state with its reset, and the closing «Хотите вести эфиры? → Стать экспертом» plate.

**The expert page** — canvas **«Эксперт»**, **vendored verbatim** at [`design-source/expert-page.dc.html`](../../../../../../design-source/expert-page.dc.html) (pulled 2026-08-13, canvas file «Эксперт.dc.html»). Its composition fork is carried by a canvas prop, and the **canvas default is the operative Stage-A pick**:

- **`layout` enum `a | b` — default `b` = the operative pick:** a wide blue hero (square photo plate with name, role, credentials, bio and stat row) over single-column content. Variant **`a`** — a sticky bio card in a left column with the content in a right column (`minmax(280px,340px) 1fr`) — is recorded as the **rejected alternative**; it stays in the canvas as a design-review switch, not as a product option.
- **`showPodcast` — default `true`:** the podcast-episode rows render. With it off the section is absent entirely — which is exactly the behavior required for an expert the academy's media has not featured (US-10), so the prop is a **content-driven state, not a second design**.
- **`manyProjects` — default `true`:** «Где участвует» shows the first four project rows with an «Ещё N» expand control. With it off the list is short enough to render in full with no expand control — again a content-driven state.

The fixed composition switcher at the bottom-left of both canvases is a design-review aid, not a product control, and is not built.

**The expert card** is the **shared unit** — canvas **«ЭкспертКарточка»**, already vendored at [`design-source/expert-card.dc.html`](../../../../../../design-source/expert-card.dc.html) for feature 013 (the home page `dc-import`s it) and **reused here unchanged**: the catalog grid, the home page's expert grid and the project page's team grid are three instances of one card, not three cards. That sharing is the point — a change to how a person is presented happens once.
