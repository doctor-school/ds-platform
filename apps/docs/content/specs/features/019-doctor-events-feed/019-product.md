---
title: "Feature 019 — Doctor events feed (PRD)"
description: "Product requirements for `#d-events` — the doctor storefront's own events surface on `doctor.school`: a day-grouped week feed and a month calendar over the same 004 listing engine, a «идёт сейчас» live strip, a «Прошедшие» slice that leads into recordings, a short «Мои события» cut, and the `events-filter` facet panel drawn at full REQ-138 strength with its intermediate fill states (owner decision D-1). Wave 1 of the two-site IA epic; source of the 019 EARS triplet (ADR-0014)."
slug: two-site-ia-019-doctor-events-feed-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`019-product-ru.md`](./019-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 1** (017 → 018 → **019** → 020 → 021). `blocked_by` **017** (the doctor storefront shell) and **018** (the content-card anatomy the feed reuses). 019 consumes the **004** listing engine and event card, **014** recordings and **006** the live room — it re-invents none of them (REQ-137).

## Feature summary

Doctors come to `doctor.school` **first of all for events** — online and offline (owner revision R4 №1). On the Academy site events are a section of a media surface; on the doctor storefront they are the reason to open the site at all. Feature 019 gives the doctor an events surface of their own, targeted at their specialty, that answers three questions at a glance: **what is running right now**, **what is happening this week near me**, and **what did I miss — is there a recording**.

The screen is a composition, not a new engine. The day-grouped feed, the month/week calendar, the event card and the archive slice are the units already shipped for the Academy (`webinars-listing`, `webinars-month`, `webinar-card`, `webinar-archive`); 019 assembles them inside the doctor shell (017) with the card anatomy 018 fixes, and widens the format vocabulary — an **offline colleagues' meet-up (Doctor Club)**, a **congress** and a **podcast broadcast** are first-class formats in the same feed, not sub-kinds of a webinar (REQ-15, REQ-2).

019 also carries one **platform-wide responsibility**: the shared facet panel `events-filter` grows here from wave-1's two toggles to the **full REQ-138 facet set**, and the Academy catalogs later reuse that same panel. A panel with two buttons and a panel with seven facets behave differently, so by owner decision **D-1** the panel is designed at full strength _and_ in its intermediate fill states — the grid must not break as facets land wave by wave.

The feed is **fully readable by a guest** (REQ-20): the value is visible before registration, and only the act of taking part routes through sign-up with a return to this exact place. «Мои события» appears here as a **short cut with a link into the doctor's personal cabinet** (`#d-lk`), never as a second full section (owner decision D-2).

## User stories

- **US-1** — As a **doctor**, I open «События» and see what is happening in my specialty this week, grouped by day, so choosing where to go takes one screen and not a search.
- **US-2** — As a **doctor**, I see at a glance that an эфир **is running right now**, and get into it in one action if I am registered — or onto the event page if I am not.
- **US-3** — As a **doctor**, I switch between a **week feed and a month calendar**, because «what is on Thursday» and «what is on this month» are two different questions.
- **US-4** — As a **doctor**, one feed shows me **every format** — webinar, offline colleagues' meet-up, congress, podcast broadcast, online meeting — and I can tell them apart without reading the text.
- **US-5** — As a **doctor who mostly attends in person**, an offline meet-up shows me its **city and remaining seats** in the feed, so I know whether it is even reachable before I open it.
- **US-6** — As a **doctor**, I narrow the feed by the facets that matter to me — format, kind, specialty, city, НМО, availability — and the applied facets stay visible with a way to reset them.
- **US-7** — As a **doctor on a phone**, the facet panel collapses into a «Фильтры» control with a count of what is applied, and the feed stays readable at 390.
- **US-8** — As a **doctor**, when nothing matches I am told **which condition emptied the screen** and offered a weaker one («все специальности» instead of «моя и смежные») — never a blank page.
- **US-9** — As a **doctor in a rare specialty**, when my specialty has nothing yet the screen offers the **nearest events in adjacent areas** instead of an empty state.
- **US-10** — As a **doctor**, I see **how many colleagues have already signed up** on a card («уже записались 37 ортопедов»), because that is the strongest signal that an эфир is worth my evening.
- **US-11** — As a **doctor**, I switch to «Прошедшие» and reach the **recording and the materials** of something I missed, and can take the discussion into the community.
- **US-12** — As a **signed-in doctor**, a short «Мои события» block reminds me what I am signed up for — including a congress ticket — and links me into my personal cabinet for the full list.
- **US-13** — As a **guest doctor**, I browse the whole feed without an account, and the action on a card takes me through registration and **back to this screen**.
- **US-14** — As a **product owner**, the feed, the calendar, the card and the facet panel are **shared design-system units** — the doctor storefront and the Academy show an event the same way and change it in one place.
- **US-15** — As a **product owner**, the facet panel is designed for the whole REQ-138 set **and** for the states it passes through while facets ship one by one, so no wave forces a redesign of the screen (D-1).

## Flows

**Browse the week (US-1, US-3, US-4, US-5, US-10):**

1. The doctor opens «События» inside the doctor shell → breadcrumbs «<специальность> › События», the title, the view row (Неделя / Месяц · Будущие / Прошедшие), then the live strip if there is one, then the day-grouped feed.
2. Cards carry date and time, format, kind, speaker, the source school or project, НМО where applicable, the Pul cost (zero cost reads as **«бесплатно для врача»**) and the sign-up count.
3. An offline card additionally carries the **city and the seat count**; a congress spans dates and may be hybrid.
4. A click on a card opens the event page (`#d-event`, feature 020).

**Switch to the month (US-3):** the view switch moves the body to the month grid, with «Сегодня» and the live marker; the content changes, the units do not.

**Filter (US-6, US-7, US-8, US-9):**

1. The first facet row is the wave-1 pair — view and Будущие/Прошедшие. The second row carries the rest of REQ-138: format, kind, specialty (default «моя и смежные»), city for offline, «только с НМО», «бесплатно по Pul», name search.
2. Applied facets stay visible with a reset; at 390 the panel collapses behind «Фильтры» with a count.
3. An empty result names the condition that emptied it and proposes weakening it; an empty **specialty** offers adjacent areas instead.

**Right now (US-2):** while an эфир is live, the live strip shows LIVE, the title and the presence count. A registered doctor enters the room (feature 006); a doctor who is not registered goes to the event page — never straight into the room. With no live эфир the strip is absent and leaves no hole in the grid.

**Past events (US-11):** «Прошедшие» re-reads the same cards with a changed meaning — recording and materials instead of sign-up — and adds the community-discussion link. Recording availability comes from feature 014.

**My events (US-12):** a signed-in doctor sees a short cut of what they are signed up for, including a congress ticket, and a link «Все мои события в личном кабинете». A guest does not see the block at all.

**Guest (US-13):** the whole feed is readable; the card action routes to registration (feature 021) and returns the doctor to this screen.

**Branches:** loading renders skeletons for the feed and the month grid; a load error states the cause and offers a retry while the other blocks stay alive; a card carries its own states — normal, hover, focus, «вы записаны», «мест не осталось», «идёт сейчас», «прошло — есть запись».

## Product acceptance criteria

- «События» is a **standalone screen of the doctor storefront**, reachable from the shell navigation, and is **fully readable without an account** — the card action, not the page, is what requires registration (REQ-20).
- The screen shows the doctor's specialty and adjacent areas by default, and lets that be widened to all specialties from the facet panel.
- **Every event format** — webinar, online meeting, offline colleagues' meet-up, congress, podcast broadcast — appears in one feed and is distinguishable at a glance; an offline event carries its city and seat count wherever it is rendered (REQ-2, REQ-15).
- The doctor can switch between a **week feed grouped by day** and a **month calendar**, and between **Будущие and Прошедшие** (REQ-75, REQ-138 wave 1).
- A **live эфир is surfaced on the screen** with its presence count; the action leads into the room only for a registered doctor and to the event page otherwise. With nothing live the block is absent, not empty (REQ-137).
- The **facet panel is the shared `events-filter` unit**, carries the full REQ-138 set, keeps applied facets visible with a reset, and collapses behind a counted «Фильтры» control on mobile.
- The panel is **specified and designed in its three fill states** — wave 1, intermediate (format + kind added), full set — and moving between them does not break the screen grid (**D-1**).
- An empty result is **never a blank screen**: it names which condition emptied it and offers a concrete way to weaken it; an empty specialty offers adjacent areas.
- A card states **how many colleagues have already signed up** (REQ-38).
- «Прошедшие» leads to the **recording and materials** where they exist (feature 014) and offers the community discussion.
- «Мои события» is a **short cut with a link to `#d-lk`** and is absent for a guest (**D-2**).
- Cost is expressed **only in Pul attention points**, never in roubles, and zero cost reads as «бесплатно для врача»; there is no subscription and no cart (REQ-48, NG-5 / CON-16). Partner-funded content carries only its **legal advertising marking** — who funds an event is never surfaced as interface copy.
- НМО is a **badge and a facet**, never the screen's headline or its primary filter (NG-1); Academy media noise — podcasts, Academy news — does not enter this feed (NG-2).
- The feed, calendar, card, archive slice and facet panel are **shared units**; 019 adds no private copies and no listing mechanics of its own (REQ-137).
- The screen works at 1440 and 390 in both themes, and meets the platform accessibility bar for a public surface — facets are real controls with visible state, cards are real links, the view switch is keyboard-operable.

## Out of scope

- **The live room itself** — feature 006; 019 provides only the way in.
- **The event page** — feature 020 (`#d-event`).
- **Registration and consents** — feature 021; 019 only routes into it and back.
- **The full «Мои события» section, tickets and НМО check-ins** — `#d-lk` (feature 022) and features 020 / 038.
- **Recording production and editing states** — feature 014; 019 links to what 014 publishes.
- **Academy surfaces** — projects, partners, podcasts, Academy news (NG-2, REQ-24).
- **Event authoring / the event constructor** — feature 041, wave 7.
- **Mobile-app screens** — separate track (F-4).
- **The exact facet composition at EARS level** — REQ-138 states the principle; the shipped subset per wave is an EARS decision, not a PRD one.

## Open questions

- **How the seven facets are laid out** — fork F-1 below was **raised to the owner 2026-08-23 and is unanswered**; the canvas default is a working assumption, not a decision.
- **Which facets ship in wave 1 of 019 itself.** D-1 fixes that the design covers the full set; which facets are actually built first is not fixed by this PRD.
- **URL persistence of feed state** — whether view, tense and applied facets survive in the URL (shareable, back-button-safe) is unresolved, and is the same open question 014 left for the «Прошедшие» tab. _(agent-proposed — UNCONFIRMED.)_
- **Feed depth and paging** — how far «Будущие» and «Прошедшие» run before paging is needed. _(agent-proposed — UNCONFIRMED.)_
- **What «моя и смежные» means concretely** — the adjacency directory that targets the feed is owned by 018; 019 consumes it and does not define it.
- **Whether congress events belong in this feed at all** — the congress front is feature 026 in a late wave, while congress events appear here in wave 1. _(agent-proposed — UNCONFIRMED.)_

## Stage-A развилки (owner picks)

The canvas [`design-source/doctor-events.dc.html`](../../../../../../design-source/doctor-events.dc.html) carries each fork as an editor prop, and **the prop default is the working assumption, not the owner's pick**. Every row below needs an explicit pick before implementation.

| #   | Fork                                          | Options (canvas prop)                                                                                                                                                | Canvas default             | Owner pick                                                                                           |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| F-1 | How the facet panel fits the full REQ-138 set | `panelVariant`: **А** — chip row above the feed · **Б** — left sidebar on desktop, sheet on mobile · **В** — view row + «Фильтры» button, facets inside a disclosure | **А — строка чипов**       | **PENDING** — raised to the owner 2026-08-23, unanswered                                             |
| F-2 | Relationship of week and month                | `layoutVariant`: **А** — one view at a time via a switch · **Б** — both at once (month as navigation, day feed as body)                                              | **А — переключатель вида** | **PENDING**                                                                                          |
| F-3 | Where «Идёт сейчас» lives                     | `liveVariant`: **А** — block above the feed · **Б** — pinned strip visible while scrolling · **В** — highlighted card inside today's day group                       | **А — блок над лентой**    | **PENDING**                                                                                          |
| F-4 | Which facet fill state the screen opens on    | `filterWave`: волна 1 · промежуточное (формат и тип) · полный набор                                                                                                  | **полный набор**           | **N/A** — a canvas viewing default, not a product choice: all three states stay mandatory by **D-1** |

**Content-driven states, not forks** (no owner pick needed — they are the screen's honest behaviour): `loggedIn` (guest / signed in), `dataState` (обычно · загрузка · пусто по фильтру · пусто по специальности · ошибка · нет живого эфира). `cardBoard` is the card-state stand — a design-review aid, not a product control, and it is not built.

## Approved-mockup reference

**Canvas:** [`design-source/doctor-events.dc.html`](../../../../../../design-source/doctor-events.dc.html) — drawn by the owner from the screen prompt [`03-d-events-ru.md`](../../product/two-site-ia/design-prompts-ru/03-d-events-ru.md) and vendored into the repo (#1450). It is the **single source of truth for composition, geometry and states**; this PRD's prose never overrides it (ADR-0013).

**Canvas defaults are the working assumption for reading the design; the Stage-A pick is this PRD's fork table above.** Where a fork is still `PENDING`, the canvas default only documents what the drawing happens to show — it is **not** build authorisation: an explicit owner pick is required before implementation of that row, and no variant may be inferred from what the canvas renders (AGENTS.md §6, Stage A).

The event card is the **shared unit** [`design-source/webinar-card.dc.html`](../../../../../../design-source/webinar-card.dc.html) (`dc-import` «ВебинарКарточка»), with its anatomy owned by 018; the feed, month grid, archive slice and facet panel are likewise the existing shared canvases (`webinars-listing`, `webinars-month`, `webinar-archive`, `events-filter`). 019 composes them; it does not fork them.
