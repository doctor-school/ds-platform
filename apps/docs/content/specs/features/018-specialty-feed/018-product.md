---
title: "Feature 018 — The specialty feed (PRD)"
description: "Product requirements for the doctor's return screen on `doctor.school`: one targeted mixed feed for a chosen specialty — schools and courses (the course as a series), the nearest events including offline meet-ups, lessons shared with the mobile app, a «Зачем это мне» value block, explicitly labelled adjacent areas, the specialty-filtered scale statistics, the consent-gated specialty leaderboard and communities. Also the screen where the doctor content card's anatomy is decided for every later screen. Wave 1, `blocked_by` 017; source of the 018 EARS triplet (ADR-0014)."
slug: two-site-ia-018-specialty-feed-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`018-product-ru.md`](./018-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Second in wave 1** (017 → 018 → 019 → 020 → 021). 018 is `blocked_by` **017** — the feed lives inside the storefront shell and is targeted by the specialty 017 lets the doctor choose; without the adjacency reference book the targeting is undefined. Taxonomy canon: ADR-0016 §5, §8.

## Feature summary

017 gets a doctor to say what they do. 018 is what they get for saying it — and it is **the screen they come back to**. Every subsequent visit to `doctor.school` lands here, so this screen has to do in one view what a whole site normally does: show that there is something to learn, something to attend, and someone to grow with, without drowning a reader whose attention is measured in minutes between patients.

The feed is **one mixed stream for one specialty**, assembled from things that are already distinct products: **schools and courses** (a course is presented as a **series** — «9 серий» — because the single-series format is the platform's key novelty, REQ-16, and a school is the doctor's end product, not an Academy project, REQ-50); **the nearest events**, where an offline colleagues' meet-up is a **format of event and a value of its own**, not a sub-kind of webinar (REQ-15); and **lessons**, the same lessons the mobile application serves, on one shared points account (REQ-53) — stated on the storefront as «продолжите на телефоне», never as a separate section.

Three blocks make the offer legible rather than merely present. **«Зачем это мне»** says the value exchange in the doctor's own terms — a new specialty, an international placement, mentorship, a document at the end of a course, and **«всё бесплатно для врача»** (REQ-12, REQ-13); what stands behind that economically is never written into the interface. **Смежные области** names the adjacent specialties explicitly (REQ-1) — adjacency is a managed reference table (OWD-11), so adjacent content is **labelled as adjacent** and never quietly mixed in as the doctor's own. The **specialty-filtered scale line** (REQ-116) and the **specialty leaderboard** (REQ-117, consent-gated by REQ-34) put the doctor among peers — «видишь себя в будущем» — and **Сообщества** points at the associations, standards and consensuses of the direction.

018 also carries a load-bearing design deliverable: **the anatomy of the doctor content card**. That single unit is later reused by the school screen, the learning module and the home page's selections, so deciding it late means rebuilding the screens that depend on it. Its variants are the second Stage-A fork below.

The storefront rule holds throughout: **no Academy noise** — no projects, no partner news, no Academy podcasts (NG-2, REQ-24) — and the word «проект» never appears in a doctor's interface. НМО is an attribute of an event, never a headline or the screen's main filter (NG-1). A guest sees the whole feed — the value is visible before registration (REQ-20) — with content cards carrying an honest «нужна регистрация» gate.

## User stories

- **US-1** — As a **doctor who has chosen a specialty**, I see in one screen everything the platform has for me — what to learn, what to attend, who to grow with — instead of a catalog I have to search.
- **US-2** — As a **returning doctor**, this is the screen I land on, and I can tell at a glance what is new since last time.
- **US-3** — As a **doctor**, I see schools and courses for my specialty, and I understand a course is a **series** with a number of episodes rather than an academic module plan.
- **US-4** — As a **doctor**, I see the nearest events for my specialty, including **offline meet-ups with colleagues** presented as a real format and not as a lesser kind of webinar, and I can go to the full events feed for my specialty.
- **US-5** — As a **doctor**, I see how many colleagues have already signed up for an event, so I can judge whether it is worth my evening.
- **US-6** — As a **doctor**, I see lessons here and know that **the same lessons are in the mobile app on one shared points account** — the site and the app are one product, not two catalogs.
- **US-7** — As a **doctor weighing whether to invest my time**, the «Зачем это мне» block says in plain words what I get — a new specialty, an international placement, mentorship, a document — and that **it is free for me**.
- **US-8** — As a **doctor in a narrow specialty**, adjacent areas are **labelled as adjacent**, so I always know what is mine and what is neighbouring, and I can reach that content deliberately.
- **US-9** — As a **doctor**, the statistics line tells me the scale **of my own specialty** — how many colleagues, how many schools, how many lessons — not the platform's total.
- **US-10** — As a **doctor**, the leaderboard for my specialty shows me where I could be; if I never consented to public display, I have no row there and the block explains that calmly.
- **US-11** — As a **doctor**, I find the communities and associations of my direction — standards of care, consensuses, membership — instead of hunting for them elsewhere.
- **US-12** — As a **guest**, I can read the whole feed before registering and the cards tell me honestly which step needs an account, so I decide with the value in front of me.
- **US-13** — As a **doctor whose specialty is rare and has no content yet**, the feed says so honestly and offers adjacent areas and general events instead of showing me an empty screen.
- **US-14** — As a **doctor on a phone**, the whole feed — cards, events, statistics, leaderboard — works as well as on desktop.
- **US-15** — As a **product owner**, the **doctor content card** is one shared unit decided here and consumed unchanged by the school screen, the learning module and the home page's selections.

## Flows

**The returning doctor's main path (US-1, US-2, US-3, US-4, US-6):**

1. A doctor with a chosen specialty opens the storefront → the shell from 017 renders with breadcrumbs and the specialty heading, which carries «сменить специальность».
2. Below it the statistics line for that specialty, then the feed's blocks: schools and courses; the nearest events with «Все события по специальности»; lessons with the lesson of the day and the mobile-app line; «Зачем это мне»; adjacent areas; the specialty leaderboard; communities.
3. A card leads into its own surface — a school, a lesson, an event page (feature 020) — where registration (021) takes over when the content requires it.

**A guest reading before registering (US-12):**

1. A guest opens the same feed and sees every block.
2. Content cards render the gate state («Смотреть — нужна регистрация») instead of hiding the item; nothing pretends the content is unavailable, and nothing lets a guest through into gated content.
3. The gate leads into registration (feature 021) and back.

**Changing specialty (US-8):**

1. «сменить специальность» in the heading re-opens 017's catalog; a new choice re-targets the whole feed.
2. Adjacent-area entries lead to the adjacent specialty's own feed, and the transition is explicit — the doctor always knows whose feed they are reading.

**Branches:**

- **Nothing at all for the specialty** → the feed states it plainly and offers adjacent areas and general events; it never renders as an empty page.
- **Partially empty** (no schools yet, events already there) → the schools block shows «готовится» and stays; it does not silently disappear.
- **One block fails to load** → that block shows the reason and a retry; the rest of the feed keeps working.
- **The doctor never consented to public display** → no row of theirs in the leaderboard, with a calm explanation.
- **A card the doctor has already started** → it shows its progress; a finished one shows as completed.

## Product acceptance criteria

- The feed is **targeted by the doctor's chosen specialty** and by **adjacency read from the managed reference table** (ADR-0016 §5, OWD-11); adjacent content is **explicitly labelled as adjacent** and never presented as the doctor's own specialty.
- The feed is **publicly readable** — a guest sees every block; gated content renders an honest gate state on the card rather than disappearing, and no gated content is served to a guest.
- **Schools and courses** are shown as the doctor's end products; a course carries its **series** framing with the episode count. The word «проект» never appears in the doctor's interface, and the Academy's backstage is not shown.
- The **nearest events** block uses the shared event card, shows the **sign-up counter at all times**, presents an **offline meet-up as a format of event** (not a new card), and links to the full events feed for the specialty (REQ-2, REQ-38).
- The **lessons** block presents the lesson of the day through the doctor content card and states that the **same lessons exist in the mobile application on one shared points account** — as a line in this block, never as a separate section of the site.
- **«Зачем это мне»** states the exchange **from the doctor's side** — attention and time in exchange for learning and career — and says that it is **free for the doctor**. The interface **never names who finances it**.
- The **statistics line is filtered to the specialty** (colleagues, schools, lessons), not the platform-wide figure.
- The **leaderboard is filtered to the specialty** and contains only doctors who gave **separate consent to public display**; the default is not to publish, and a doctor without consent sees an explanation rather than a missing block.
- The **communities** block lists the associations and communities of the direction with what they are for (standards, consensuses, membership).
- The screen delivers the **doctor content card as one shared unit** with its full state set — normal, hover, focus, started (progress), completed, gate — and the later screens consume it unchanged.
- **Empty, partially empty, loading and per-block error states** are all handled as specified above; a user-facing placeholder is never shipped in place of one.
- The feed carries **no Academy content** (NG-2, REQ-24), **no prices, cart or subscription**, and **no НМО framing as the screen's headline or main filter** (NG-1) — НМО remains an attribute of an event.
- No **personalised recommendation** claims («на основе ваших данных», an explained algorithm) are made — the package defines no recommendation mechanics.
- The whole feed works at the **mobile breakpoint** and meets the platform accessibility bar for a public surface (`playwright-axe`): cards are real links, the gate state is announced, block headings are a navigable structure.

## Out of scope

- **The shell** (header, navigation, footer) and the **specialty choice itself** — feature **017**; 018 consumes them and adds breadcrumbs plus the specialty heading.
- **The full events feed** (`#d-events`), its facet panel and its week/month views — feature **019**; 018 links to it.
- **The event page, the room and registration** — features **020** / **021** / **006**.
- **The school screen and the learning module** — separate wave-2 screens; 018 links into them and hands them the card unit.
- **The lesson screen and the points plate's anatomy** — decided on the `#d-lesson` canvas; 018 uses the plate in its base form.
- **The mobile application** — a separate track and repository (owner decision F-4); 018 only states that the lessons are shared.
- **Recommendation mechanics** — no ranking, personalisation or algorithmic feed is specified by the package.
- **Consent management** for public display — the toggle lives in the doctor's cabinet; 018 only honours the consent state.
- **The communities' own surfaces** (a community page, membership flow) — 018 lists them and links out.

## Open questions

- **The order and weight of the blocks** — the first Stage-A fork below. The package fixes the composition of the feed, not its hierarchy, and the choice decides whether a doctor's first impression is «learn» or «attend».
- **The anatomy of the doctor content card** — the second fork, and the one with the widest blast radius: four screens consume the result.
- **How adjacent areas are surfaced** — a block at the end or a marker on the cards inside the main blocks (third fork).
- **The canvas's payer copy must be fixed on the owner's side.** The vendored `doctor-feed` canvas carries the line «обучение оплачивают партнёры платформы», which violates the package's hard rule that the interface never names who pays; this PRD's copy says only «бесплатно для врача». **Owner-side canvas fix pending** — until then the canvas and this PRD disagree on that line, and the PRD wins.
- **Where the communities block's requirement lives.** The screen prompt sources it from REQ-120, which is **not in the functional map's REQ list for 018**; whether communities belong to this feature's scope at all needs an owner call.
- **What «скоро» means for a school in preparation** — who sets it, and whether a doctor can register interest.
- **How much of the feed is shown before it needs pagination or «показать ещё»** — the package fixes the blocks, not their depth.
- **Whether the feed's blocks are ordered per doctor or identically for everyone** with the same specialty. This PRD assumes identical. _(agent-proposed — UNCONFIRMED.)_
- **Where the mobile-app line leads** — a store link, a QR, or plain text — given that the app is a separate track.

## Stage-A forks (развилки)

All three forks come from the screen prompt. **The canvas default is a working assumption only** — an owner pick is still required, and nothing here is recorded as decided.

| #           | Fork                               | Options                                                                                                                                                                                                       | Canvas default                                                                                         | Lead recommendation                                                                                                                                                                                                                          | Owner pick                                                                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **F-018-1** | Order and weight of the blocks     | **А** — «сначала учиться»: schools and courses on top, events below · **Б** — «сначала прийти»: the nearest events on top · **В** — one mixed chronological stream distinguished by card type                 | **А** (canvas prop `blockOrder`, default `А`)                                                          | **non-default — Б.** The owner's own R4 №1 observation is that doctors come to `doctor.school` **for events first**, and wave 1 was sequenced so the first visible result reaches «Участвовать». **А** contradicts that on the return screen | **Б** — owner pick 2026-08-25, interactive walkthrough; verbatim: «Б — события вверху (Рекомендуется)»          |
| **F-018-2** | Anatomy of the doctor content card | **А** — a card with a cover image · **Б** — a typographic card with no image (kicker, title, metadata, counter) · **В** — a compact list row for dense selections plus a large card for the block's lead item | **Б** (canvas prop `cardVariant`, default `Б`; `В` renders the lead item as `Б` and the rows as a row) | **Б** — cheapest to operate (covers have to be produced by someone) and closest to the existing `webinar-card`; **А** raises a content-production obligation the package does not fund                                                       | **Б** — owner pick 2026-08-25, interactive walkthrough; verbatim: «Б — без картинки (Рекомендуется)»            |
| **F-018-3** | How adjacent areas are surfaced    | a separate block at the end of the feed · a «смежная» marker on the cards inside the main blocks                                                                                                              | the **separate block** — the canvas resolved this silently and carries **no prop** for it              | none — but whichever is picked, OWD-11's rule holds: adjacent content is always labelled, never silently mixed in                                                                                                                            | **Отдельный блок** — owner pick 2026-08-25, interactive walkthrough; verbatim: «Отдельный блок (Рекомендуется)» |

**State variants on the canvas (content-driven, not design forks):** sign-in status (guest with gated cards / signed in), and the `dataState` prop (`обычно` default · loading skeleton · empty for the specialty · partially empty · per-block error), plus the content card's own states (normal, hover, focus, started, completed, gate, «скоро»). These are states the built screen must handle, not options to choose between.

## Approved mockup

**Stage A is not resolved for this feature.** The owner drew the canvas and it is vendored; the **canvas defaults are the working assumption, and the Stage-A pick is this PRD's fork table above** — no fork is decided until the owner records a pick there.

- **Canvas:** [`design-source/doctor-feed.dc.html`](../../../../../../design-source/doctor-feed.dc.html) — screen `#d-feed`, drawn by the owner from the screen prompt [`02-d-feed-ru.md`](../../product/two-site-ia/design-prompts-ru/02-d-feed-ru.md); the feed's composition drawn from scratch on the tokens of `design-system.dc.html`; the shell is taken from the `#d-home` canvas and not redrawn.
- **Units reused as-is:** the storefront shell (from `#d-home`), the event card (`webinar-card.dc.html`, with the sign-up counter always visible), the expert card (`expert-card.dc.html`) where mentorship shows a person, and the points plate in its base form (its anatomy is decided on the `#d-lesson` canvas).
- **Unit decided here:** the **doctor content card** — its anatomy is fixed on this canvas (fork F-018-2) and consumed unchanged by the later screens.
- **One canvas line is a known defect and is not to be built:** «обучение оплачивают партнёры платформы» — the interface never names the payer; the operative copy is «бесплатно для врача». The canvas fix is pending on the owner's side (see Open questions).
- The composition switcher fixed at the bottom of the canvas is a **design-review aid, not a product control**, and is not built.
