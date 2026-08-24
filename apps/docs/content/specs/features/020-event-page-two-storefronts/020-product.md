---
title: "Feature 020 — Event page for both storefronts (PRD)"
description: "Product requirements for `#d-event` / `#a-event` — one event page serving the doctor storefront and the Academy from a single canvas (decision D-4): the open, registration-free part with social proof, the single «Участвовать» CTA with Pul cost and advance for a partner-referred doctor, the format block that swaps the live room for an address, map and QR ticket offline, live-эфир interaction (question to the lecturer, live polls, НМО check-ins), post-event rating, review and the partner mini-survey. A re-spec of the live 004/005 surface, not a greenfield page. Wave 1; source of the 020 EARS triplet (ADR-0014)."
slug: two-site-ia-020-event-page-two-storefronts-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`020-product-ru.md`](./020-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 1** (017 → 018 → 019 → **020** → 021). `blocked_by` **019** (the card anatomy and the transition out of the doctor feed). 020 reuses **004** (`/webinars/:slug`, the single «Участвовать» CTA of EARS-3, the page states of EARS-4/5), **005** (event registration), **006** (the live room) and **014** (archive and recordings).

## Feature summary

The event page is **the conversion point of the whole doctor funnel**. A link to it arrives from a partner's medical representative, from the doctor's events feed (019) or from the specialty feed (018), and it must **just work without a sign-in**: the doctor understands the value in seconds and takes part — registration happening _after_ «Участвовать», at the moment of maximum interest, not before the page can be read (REQ-20, REQ-23).

**This is a re-spec of a live surface, not a greenfield page.** `/webinars/:slug` already runs in production from feature 004, with registration (005), the live room (006) and recordings (014) behind it. 020 re-specifies that surface for the two-site architecture and adds what the wave-1 platform never inherited from the legacy site.

Three things are genuinely new. **One page serves both storefronts** (owner-delegated decision **D-4**): one canvas, one entity, one CTA, with a storefront header variant switching between the doctor site and the Academy — not two divergent pages that drift apart. **One page serves all three formats**: online эфир, offline meet-up and hybrid, where the _only_ block that differs is the format block — offline replaces the room with an address, a map, «как добраться» and a **QR ticket** (a new shared unit whose anatomy is fixed here and reused by «Мои события»), and hybrid carries both with the doctor's explicit «очно / онлайн» choice. And **the live-эфир interaction the legacy site had and wave 1 lost comes back** (REQ-139): «Вопрос лектору», polls with a live chart, and presence check-ins — the check-ins being the evidence base for НМО credit.

The economics stay in **attention points**: cost is a per-event Pul parameter that may be zero, and the doctor who arrives on a partner link without enough points is **let in on advance, silently** — no «not enough points» message on that path (REQ-48, REQ-49, REQ-39). There are no roubles, no subscription and no cart. Partner content on the эфир is marked as advertising and is followed by the «зашла / не зашла» vote (REQ-69); who funds the event is never interface copy.

## User stories

- **US-1** — As a **guest doctor arriving on a link from a medical representative**, I read the whole description, programme, speaker and teaser **without any account**, and decide whether this is worth my evening (REQ-20).
- **US-2** — As a **guest doctor**, when I press «Участвовать» I register in a couple of steps and land **back on this exact page**, not in some cabinet.
- **US-3** — As a **doctor**, the page has **exactly one call to action** — «Участвовать» — so there is never a choice between buying, applying and downloading.
- **US-4** — As a **doctor**, the conditions line tells me in one glance the format, the Moscow-time start, the НМО credit, the cost in Pul and my current balance.
- **US-5** — As a **doctor who came on a partner link without enough points**, I am simply let in — the advance is granted silently and I never see a «not enough points» wall (REQ-49, REQ-39).
- **US-6** — As a **doctor who found the event by myself without enough points**, I am shown how to earn what I lack (profile, lessons) instead of being blocked outright.
- **US-7** — As a **registered doctor**, I see «Вы записаны», can add the event to my calendar, get a reminder before it starts, and find it later in «Мои события».
- **US-8** — As a **doctor**, when the эфир starts, the same button takes me **into the room**, and I see how many colleagues are already there.
- **US-9** — As a **doctor in an эфир**, I can **ask the lecturer a question** and answer polls whose results I watch build up live (REQ-139).
- **US-10** — As a **doctor collecting НМО**, I make the required presence check-ins from the page and afterwards see plainly whether the credit was earned or what was missing.
- **US-11** — As a **doctor at an offline event**, I get **the address, a map and «как добраться»**, plus my ticket with a QR I show at the door — and that door scan is what counts towards my НМО.
- **US-12** — As a **doctor at a hybrid event**, I choose explicitly whether I attend in person or online, and my ticket reflects that choice.
- **US-13** — As a **doctor**, when there are no seats left I am told so honestly, rather than discovering it after registering.
- **US-14** — As a **doctor**, when an event is cancelled or moved I am told what happens to my points and when the new date will be announced.
- **US-15** — As a **doctor after the event**, I rate the эфир and leave a review my colleagues will see, and I reach the recording and the materials when they appear.
- **US-16** — As a **doctor**, I am asked a short, clearly optional partner-research question about how the materials were presented — separate from my review of the lecturer.
- **US-17** — As a **doctor**, advertising inside an эфир is **marked as advertising**, and I can say whether it landed («зашла / не зашла») (REQ-69).
- **US-18** — As a **doctor**, reminders during the эфир (take the lesson series, send your clinical case) are **soft** — never modal windows over the broadcast (REQ-40).
- **US-19** — As a **doctor without a confirmed medical-professional status**, the materials that require it are closed **with the reason explained in words** and a clear way to confirm my status (CON-11).
- **US-20** — As a **doctor**, the speaker is a link to their expert page and the source school or project is a link too, so the event is a way into the programme and not a dead end (REQ-137).
- **US-21** — As an **Academy visitor**, the same event opens under the Academy header with the same content — the two storefronts never show a different event (**D-4**).
- **US-22** — As a **product owner**, the ticket / QR unit designed here is the **same unit** «Мои события» uses in the doctor's cabinet, so a ticket is defined once.

## Flows

**Read before deciding (US-1, US-20):** the doctor opens the page from any entry point → breadcrumbs, the storefront header, the event title with date and Moscow time; then the open part — programme, speaker (link to the expert page), teaser, the source school or project, and the sign-up count («уже записались 37 ортопедов», REQ-38). All of it renders for a guest.

**Take part (US-2, US-3, US-4, US-5, US-6, US-7):**

1. The conditions line states format · time (МСК) · НМО · cost in Pul · the doctor's balance. Below it, the single «Участвовать».
2. **Guest** → registration (feature 021 / 005) → back to this page.
3. **Signed in, enough points** → «Вы записаны», calendar add, link into «Мои события», a reminder before the start.
4. **Signed in, not enough points, partner-referred** → the advance is granted automatically; the button behaves as normal and no shortfall is shown.
5. **Signed in, not enough points, self-found** → the page shows how to top up (profile, lessons) without blocking the intention.

**Online эфир (US-8, US-9, US-10, US-17, US-18):** at start time the button leads into the room (feature 006) with a presence count. On the page: «Вопрос лектору», a poll with a live chart, presence check-ins for НМО, a partner lecture **marked as advertising** with the «зашла / не зашла» vote, and soft reminders.

**Offline (US-11, US-13):** the format block carries the address, the map, «как добраться», the seat count and remaining seats, and the doctor's ticket with its QR. The door scan is a source of presence evidence for НМО. With no seats left the page says so honestly (the treatment is fork F-3 below).

**Hybrid (US-12):** both blocks render with an explicit «участвую очно / онлайн» choice that determines what the ticket contains.

**After the event (US-15, US-16):** rating and review; separately and optionally, the partner-research mini-survey; the recording and materials once feature 014 publishes them; and the НМО outcome stated plainly — credited, or what was missing.

**Branches:** cancelled / rescheduled is its own state that explains what happened to the points; a medical-status gate (CON-11) closes only the materials that need it and explains why, with the verification-status line unit; loading and error render a skeleton and a retry with the cause.

## Product acceptance criteria

- **One page serves both storefronts** — `#d-event` on `doctor.school` and `#a-event` on `academy.doctor.school` — differing only in the storefront header; the content, the entity and the CTA are the same (**D-4**). No second Academy event page is built.
- **One page serves all three formats** — online эфир, offline, hybrid — and the **format block is the only part that differs** (**D-4**).
- The **open part is fully readable without registration**: description, programme, teaser, speaker, preview and the sign-up count. The content itself — the эфир, the recording — requires **registration with a confirmed email**; diploma verification is **not** required for access (REQ-20).
- The page carries **exactly one CTA, «Участвовать»** — no second «купить» / «оставить заявку» / «скачать» (R4 №3, 004 EARS-3).
- A **guest pressing «Участвовать» registers and returns to this exact page**, not to a cabinet or a home screen.
- Cost is a **per-event Pul parameter that may be zero**; zero reads as «бесплатно для врача». Roubles, subscription and cart do not exist on the page (REQ-48, NG-5 / CON-16).
- A **partner-referred doctor short of points is admitted on advance automatically and silently** — a shortfall message on that path is a defect (REQ-49, REQ-39). A self-found doctor short of points is shown how to earn the difference, without being blocked.
- Partner attribution («from which partner») is preserved through registration and sign-up (REQ-39); who funds the event is **never rendered as interface copy** — only the legal advertising marking is.
- A **registered doctor** gets «Вы записаны», a calendar add, a reminder before the start, a link into «Мои события», and the ability to cancel their sign-up.
- **At event time** the CTA leads into the room for an online эфир (feature 006, with presence count) and shows the ticket / QR for an offline one.
- **Live-эфир interaction is present** (REQ-139): «Вопрос лектору», polls with a live chart, and presence check-ins; the НМО outcome is afterwards stated plainly as credited or not, naming what was missing.
- **Advertising inside an эфир is marked as advertising**, and the «зашла / не зашла» vote is available (REQ-69). Soft reminders (lessons, clinical case) are inline and never modal over the broadcast (REQ-40).
- **Offline** carries the address, a map, «как добраться», the seat count and a **ticket with a QR**; the door scan is a presence-evidence source for НМО. The ticket / QR is a **new shared unit whose anatomy is defined here** and reused unchanged by «Мои события» (`#d-lk`).
- **Hybrid** requires an explicit «очно / онлайн» choice by the doctor, and the ticket reflects it.
- **After the event**: a ★★★★★ rating and a review visible to colleagues (REQ-118); separately, an explicitly optional partner-research mini-survey (REQ-135 / REQ-10); the recording and materials from feature 014 when published.
- **Honest states exist for**: no seats left, cancelled / rescheduled (stating what happened to the points), loading, and load error with a cause and a retry.
- **CON-11**: where an event carries advertising of prescription drugs or devices requiring special training, that material is available only to a doctor with confirmed medical-professional status; the closed part is explained in words and uses the shared verification-status line unit (anatomy owned by `#d-lk`).
- НМО is a **badge and a conditions line**, never the page headline (NG-1).
- The speaker links to their expert page and the source school / project to its page; the community discussion link is present (REQ-137).
- The page works at 1440 and 390 in both themes, under both storefront headers, and meets the platform accessibility bar for a public surface.
- Nothing that 004 / 005 / 006 / 014 ship in production regresses — 020 re-specifies the surface over those engines and does not fork them.

## Out of scope

- **A second Academy event page** — one canvas, one page (**D-4**).
- **The live room itself** — feature 006; 020 provides the way in and the interaction that sits on the page.
- **The full «Мои события» section** — `#d-lk` (feature 022); 020 defines the ticket unit it reuses and links to the section.
- **НМО check-in accounting as a mechanism** — feature 038; 020 owns the check-in surface on the page and the plainly stated outcome.
- **Registration and consents themselves** — features 021 / 005.
- **Recording production and editing states** — feature 014.
- **The points economy** — the accrual and pricing rules are REQ-48 / REQ-49 open forks (below) and feature 025; 020 renders whatever the economy decides.
- **The event constructor / admin authoring** — feature 041, wave 7.
- **Mobile-app screens** — separate track (F-4).
- **A waiting-list mechanism** — no requirement exists for it; see fork F-3.

## Open questions

- **REQ-48 — the points price of a unit of content.** That price is a configurable per-event parameter is settled; **what the actual policy is** — which events cost how much, and whether zero is the default — is an **open owner call**. 020 renders the parameter; it does not decide it.
- **REQ-49 — the accrual and advance rules.** Starting points on registration, points for mini-actions, when an advance is granted and how it is worked off later are stated in the requirements as a **preliminary policy**, explicitly to be tested. They are **not decided behaviour** for this PRD: 020 needs from them only the two paths it renders (partner-referred → silent advance; self-found → shown how to top up).
- **What exactly grants НМО credit** — REQ-139 names ≥ 90 minutes of presence and 2 check-ins from the legacy site; whether the new platform keeps those thresholds is unconfirmed. _(agent-proposed — UNCONFIRMED.)_
- **What happens to points when an event is cancelled** — the draft copy promises they are returned; the actual rule follows from the REQ-48/49 economy. _(agent-proposed — UNCONFIRMED.)_
- **Where the partner-research mini-survey lives** — fork F-4 below.
- **The offline no-seats treatment** — fork F-3 below; variants А and Б need a requirement that does not exist yet.
- **Whether the Academy storefront needs any content difference at all** beyond the header — D-4 says no; if the Academy needs, say, a partner block the doctor site must not show, that is a change to D-4, not a build-time decision.

## Stage-A развилки (owner picks)

The canvas [`design-source/webinar-page.dc.html`](../../../../../../design-source/webinar-page.dc.html) carries each fork, and **the canvas default is the working assumption, not the owner's pick**.

| #   | Fork                                                | Options (canvas)                                                                                                                                                                                                                                            | Canvas default                                        | Owner pick                                                                                   |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| F-1 | Where the sign-up block lives on desktop            | **А** — pinned card on the right (conditions + «Участвовать» always visible while scrolling; strongest for conversion) · **Б** — in-flow block under the open part (base `webinar-page`) · **В** — in-flow plus a pinned narrow bar at the bottom on mobile | **none** — rendered as a side-by-side stand (`board`) | **PENDING**                                                                                  |
| F-2 | How formats switch for a hybrid event               | **А** — choice at sign-up («очно / онлайн»), the page then shows only the chosen one · **Б** — two tabs inside the format block, switchable at any time                                                                                                     | **none** — side-by-side stand (`board`)               | **PENDING**                                                                                  |
| F-3 | What happens when offline seats run out             | **А** — waiting list · **Б** — switch to online participation for hybrid, honest «мест нет» for pure offline · **В** — the «мест нет» state only                                                                                                            | **none** — side-by-side stand (`board`)               | **PENDING** — А and Б need a requirement that does not exist in the package                  |
| F-4 | Where the partner-research mini-survey (REQ-135) go | **А** — right after the event rating, as one feedback block · **Б** — a separate later step in «Мои события», keeping the lecturer review apart from the advertising assessment                                                                             | **none** — side-by-side stand (`board`)               | **PENDING**                                                                                  |
| F-5 | Which storefront header the canvas opens on         | `header`: витрина врача · Академия                                                                                                                                                                                                                          | **витрина врача**                                     | **N/A** — both are shipped (**D-4**); this is a canvas viewing default, not a product choice |

The `board` prop (`выкл` by default) is the fork stand: F-1…F-4 are drawn as variants side by side, so the canvas fixes **no default** for them — an explicit Stage-A pick is required before implementation, and no variant may be inferred from what the canvas happens to render.

**Content-driven states, not forks:** `format` (эфир · офлайн · гибрид — all three are shipped, D-4), `phase` (до начала · идёт сейчас · прошло · отменено), `auth` (гость · вошёл), `registered`, `pul` (хватает · не хватает — партнёрская ссылка · не хватает — пришёл сам), `medGate` (CON-11), `soldOut`, `nmoOk`, `pageState` (обычно · загрузка · ошибка), `speakers` (1–3).

## Approved-mockup reference

**Canvas:** [`design-source/webinar-page.dc.html`](../../../../../../design-source/webinar-page.dc.html) — the **re-drawn** version of the live event-page canvas, produced by the owner from the screen prompt [`04-d-event-ru.md`](../../product/two-site-ia/design-prompts-ru/04-d-event-ru.md) and vendored into the repo (#1450). Per decision **D-4 one canvas serves both storefronts**: `#a-event` on the Academy is the same page under the `header: Академия` variant, and no separate Academy canvas exists or is to be built.

**Canvas defaults are the working assumption; the Stage-A pick is this PRD's fork table above.** For F-1…F-4 there is no canvas default at all — the variants sit on a stand — so those picks genuinely gate implementation rather than merely confirming it.

Reused unchanged: the live room and chat [`webinar-room-frame.dc.html`](../../../../../../design-source/webinar-room-frame.dc.html) + [`chat-column.dc.html`](../../../../../../design-source/chat-column.dc.html) (entry only — the room is not re-drawn), the archive state [`webinar-archive.dc.html`](../../../../../../design-source/webinar-archive.dc.html), sign-in / registration [`auth.dc.html`](../../../../../../design-source/auth.dc.html) (returning to this page), and the expert card [`expert-card.dc.html`](../../../../../../design-source/expert-card.dc.html) in the speakers block. **New units defined here:** the **ticket / QR** (reused as-is by «Мои события» in `#d-lk`) and the **verification-status line** in its base form (its full anatomy is owned by `#d-lk`, which is drawn later; this page is aligned to it once that exists).
