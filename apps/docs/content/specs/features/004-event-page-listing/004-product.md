---
title: "Feature 004 — Public event page & upcoming-broadcasts listing (PRD)"
description: "Product requirements for the public webinar event page (pre-live state) and the upcoming-broadcasts listing in the portal app — the day-grouped week list plus the month-calendar view behind the «Неделя / Месяц» switcher. Wave 1 of the Webinars epic plus the wave-2 month-calendar slice; source of the 004 EARS triplet (ADR-0014)."
slug: webinars-004-event-page-listing-product
epic: ../../product/webinars/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`004-product-ru.md`](./004-product-ru.md)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical».

## Feature summary

The public face of a webinar: an event page that any visitor can read **without authentication** — sponsors distribute direct links through their own channels, and that link must "just work" for an unauthenticated doctor — plus a listing of upcoming broadcasts in the `portal` app with two views behind a «Неделя / Месяц» switcher: the day-grouped week list of what's next, and a month calendar that shows the whole month at a glance. The page carries everything a doctor needs to decide to attend (what, when, who, for whom, backed by whom) and a single clear CTA «Участвовать» that leads through auth (feature 003). No facets, no search.

## User stories

- **US-1** — As a **doctor**, I open a direct event link a sponsor sent me and immediately see what the webinar is about, when it airs, and who speaks — without logging in or hitting any wall.
- **US-2** — As a **doctor**, I see on the event page the date and time (MSK), the speakers, a downloadable program (PDF), the target specialties, and the partners backing the event, so I can judge relevance in under a minute.
- **US-3** — As a **doctor**, I see one clear «Участвовать» action on the event page that takes me into registration (through login/signup if I'm a guest).
- **US-4** — As a **doctor**, I open an upcoming-broadcasts listing and scan the nearest webinars (date/time, title, school/series, specialties, speakers), so I can find a relevant one even without a direct link.
- **US-5** — As a **pharma sponsor**, the event link I distribute is stable and publicly readable, so every recipient lands on the same complete page regardless of auth state.
- **US-6** — As a **doctor**, the event page tells me the event's current point in its lifecycle — upcoming, live now, or already over — so I never wonder whether I missed it.
- **US-7** — As a **doctor**, I switch the broadcasts listing between «Неделя» (the day-grouped list of what's next) and «Месяц» (a calendar of the whole month), so I pick the scanning mode that fits how I plan.
- **US-8** — As a **doctor**, in the month view I see the whole month at a glance — upcoming webinars as pills on the calendar, "live now" marked in red, the month's already-past events as muted notes, and today clearly marked (on mobile: a dot calendar with the selected day's agenda below) — so I can plan attendance around my schedule.
- **US-9** — As a **doctor**, I page between months with ‹ › and jump through a month picker that shows how many broadcasts each month carries, so I can plan weeks or months ahead.

## Flows

**Happy path — direct link (US-1, US-2, US-3):**

1. Doctor taps a sponsor-distributed link → the event page renders publicly: hero (title, school/series, date/time MSK), speakers, program PDF link, specialties, partners.
2. Doctor taps «Участвовать» → continues into the registration flow (feature 005; auth via 003 if guest).

**Listing entry (US-4):**

1. Doctor opens the upcoming-broadcasts listing in `portal` → sees published upcoming webinars, nearest first.
2. Doctor taps a card → lands on that event page.

**Month view (US-7, US-8, US-9):**

1. Doctor opens the listing → the default «Неделя» day-grouped list → taps «Месяц» in the view switcher.
2. The month calendar renders: upcoming webinars as pills, the live one in red, the month's past events as muted notes, today marked; on mobile — a dot calendar, tapping a day shows that day's agenda below.
3. Doctor pages ‹ › or picks another month in the month picker (each month showing its broadcast count) → the calendar re-renders for that month.
4. Doctor taps an event pill (or an agenda row) → lands on that event page; «Неделя» flips back to the week list, losing nothing.

**Lifecycle branches (US-6):**

- Event is **live** → the page signals "live now" and routes a registered doctor toward the room (feature 006).
- Event has **ended** → the page says so and offers no dead CTA (recordings archive is wave 2).
- Event is **draft/archived** → not publicly reachable via the listing.

## Product acceptance criteria

- The event page for a `published` event is fully readable with **zero authentication** — no soft wall, no gated sections in the pre-live state — and that public readability persists through `live` and `ended` (the page itself stays open; only the room behind the join path is server-side gated, feature 006).
- The page presents: title, school/series, date + time explicitly marked **МСК**, description, speakers, a program **PDF** link, target specialties, and partners.
- «Участвовать» is the single primary CTA and leads into registration (guest passes through auth 003 without losing the event context — handoff owned by feature 005).
- The listing shows **published upcoming** webinars ordered by nearest air date; each card carries enough to choose (date/time MSK, title, school/series, specialties, speakers).
- The page truthfully reflects the event's lifecycle state (upcoming / live / ended) from the single state machine — never a stale or contradictory signal.
- Draft and archived events are not exposed on public surfaces.
- The listing offers a «Неделя / Месяц» switcher; «Неделя» (the day-grouped list) is the default, and switching back and forth loses nothing.
- The month view shows every publicly visible event of the selected month — upcoming as calendar pills, "live now" in red, the month's already-past events as muted notes — with today marked, a legend, and on mobile a dot calendar plus the selected day's agenda.
- Month navigation works both by ‹ › paging and through a month picker whose 12 months carry per-month broadcast counts (past months muted).

## Out of scope

- Specialty facets / «Только с НМО» filter and week-paging (wave-2 backlog, later slices).
- Search.
- Recordings archive, reviews, speaker ratings, report photos/videos (wave 2+).
- Congresses, offline events, paid tiers (out of the epic).
- Registration mechanics themselves (feature 005) and the room (feature 006).

## Open questions

- Listing composition beyond the minimal card set (e.g. a "current live" banner as on the legacy home) — owner taste call at Stage A mockups.
- Archived-event direct link: US-5 promises a stable, publicly readable link, while archived events are off public surfaces — what does a distributed link show once the event is `archived` (an "event is archived" notice, a redirect to the listing, or a 404)? Owner decision needed before the 004 EARS triplet fixes this behavior.

## Approved mockup

Vendored canvas source (byte-verbatim from the Claude Design project «Doctor.School визуальный язык» — build to these files, see [`design-source/README.md`](../../../../../../design-source/README.md)):

- [`design-source/webinar-page.dc.html`](../../../../../../design-source/webinar-page.dc.html) — the public event page (US-1, US-2, US-3, US-5); lifecycle states `upcoming / live / ended` (US-6) via the canvas `status` prop.
- [`design-source/webinars-listing.dc.html`](../../../../../../design-source/webinars-listing.dc.html) — the upcoming-broadcasts listing (US-4), day-grouped week view («Неделя», the switcher's default; US-7).
- [`design-source/webinars-month.dc.html`](../../../../../../design-source/webinars-month.dc.html) — the month-calendar view of the listing (US-7, US-8, US-9): the «Месяц» pane of the «Неделя / Месяц» switcher, month picker with per-month counts, ‹ › paging, desktop grid with pills / red live pill / muted past notes / today outline, mobile dot-grid + selected-day agenda, legend.
- [`design-source/webinar-card.dc.html`](../../../../../../design-source/webinar-card.dc.html) — the card unit the listings render.

**Status:** composition authored by the product owner on the Claude Design canvas (project «Doctor.School визуальный язык»); Stage-A re-confirmation at the next owner checkpoint.
