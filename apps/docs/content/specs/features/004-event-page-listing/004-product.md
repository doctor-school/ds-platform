---
title: "Feature 004 — Public event page & upcoming-broadcasts listing (PRD)"
description: "Product requirements for the public webinar event page (pre-live state) and the minimal upcoming-broadcasts listing in the portal app. Wave 1 of the Webinars epic; source of the 004 EARS triplet (ADR-0014)."
slug: webinars-004-event-page-listing-product
epic: ../../product/webinars/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`004-product-ru.md`](./004-product-ru.md)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical».

## Feature summary

The public face of a webinar: an event page that any visitor can read **without authentication** — sponsors distribute direct links through their own channels, and that link must "just work" for an unauthenticated doctor — plus a minimal listing of upcoming broadcasts in the `portal` app. The page carries everything a doctor needs to decide to attend (what, when, who, for whom, backed by whom) and a single clear CTA «Участвовать» that leads through auth (feature 003). No calendar, no facets in wave 1.

## User stories

- **US-1** — As a **doctor**, I open a direct event link a sponsor sent me and immediately see what the webinar is about, when it airs, and who speaks — without logging in or hitting any wall.
- **US-2** — As a **doctor**, I see on the event page the date and time (MSK), the speakers, a downloadable program (PDF), the target specialties, and the partners backing the event, so I can judge relevance in under a minute.
- **US-3** — As a **doctor**, I see one clear «Участвовать» action on the event page that takes me into registration (through login/signup if I'm a guest).
- **US-4** — As a **doctor**, I open an upcoming-broadcasts listing and scan the nearest webinars (date/time, title, school/series, specialties, speakers), so I can find a relevant one even without a direct link.
- **US-5** — As a **pharma sponsor**, the event link I distribute is stable and publicly readable, so every recipient lands on the same complete page regardless of auth state.
- **US-6** — As a **doctor**, the event page tells me the event's current point in its lifecycle — upcoming, live now, or already over — so I never wonder whether I missed it.

## Flows

**Happy path — direct link (US-1, US-2, US-3):**

1. Doctor taps a sponsor-distributed link → the event page renders publicly: hero (title, school/series, date/time MSK), speakers, program PDF link, specialties, partners.
2. Doctor taps «Участвовать» → continues into the registration flow (feature 005; auth via 003 if guest).

**Listing entry (US-4):**

1. Doctor opens the upcoming-broadcasts listing in `portal` → sees published upcoming webinars, nearest first.
2. Doctor taps a card → lands on that event page.

**Lifecycle branches (US-6):**

- Event is **live** → the page signals "live now" and routes a registered doctor toward the room (feature 006).
- Event has **ended** → the page says so and offers no dead CTA (recordings archive is wave 2).
- Event is **draft/archived** → not publicly reachable via the listing.

## Product acceptance criteria

- The event page for a `published` event is fully readable with **zero authentication** — no soft wall, no gated sections in the pre-live state.
- The page presents: title, school/series, date + time explicitly marked **МСК**, description, speakers, a program **PDF** link, target specialties, and partners.
- «Участвовать» is the single primary CTA and leads into registration (guest passes through auth 003 without losing the event context — handoff owned by feature 005).
- The listing shows **published upcoming** webinars ordered by nearest air date; each card carries enough to choose (date/time MSK, title, school/series, specialties, speakers).
- The page truthfully reflects the event's lifecycle state (upcoming / live / ended) from the single state machine — never a stale or contradictory signal.
- Draft and archived events are not exposed on public surfaces.

## Out of scope

- Calendar view and specialty facets / «Только с НМО» filter (wave 2).
- Search.
- Recordings archive, reviews, speaker ratings, report photos/videos (wave 2+).
- Congresses, offline events, paid tiers (out of the epic).
- Registration mechanics themselves (feature 005) and the room (feature 006).

## Open questions

- Listing composition beyond the minimal card set (e.g. a "current live" banner as on the legacy home) — owner taste call at Stage A mockups.

## Approved mockup

_To be filled at Stage A by `author-design-mockup` (product-owner choice recorded before implementation)._
