---
title: "Feature 005 — Event registration & «my events» (PRD)"
description: "Product requirements for webinar registration on top of shipped auth (feature 003): logged-in one-tap registration, guest-through-auth flow, «my events» visibility, and registration state on the event page. Wave 1 of the Webinars epic; source of the 005 EARS triplet (ADR-0014)."
slug: webinars-005-event-registration-product
epic: ../../product/webinars/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`005-product-ru.md`](./005-product-ru.md)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical».

## Feature summary

Registration for a webinar, built on the already-shipped auth foundation (feature 003): a logged-in doctor registers in one tap; a guest who taps «Участвовать» goes through login/signup and comes out **registered for that same event** — never dropped back to re-find it. Registration is what later grants room access (feature 006) and what puts the doctor on the sponsor's attendance roster. The feature also closes a known legacy gap: after registering, doctors could not find the event they signed up for — so registered events are visible in a personal «мои события» surface, and the event page itself reflects the registered state with clear join signposting.

## User stories

- **US-1** — As a **logged-in doctor**, I register for a webinar in one tap on the event page, so committing takes seconds.
- **US-2** — As a **guest doctor**, tapping «Участвовать» takes me through login/signup (feature 003) and completes my registration for that same event, so I never have to find the event again after authenticating.
- **US-3** — As a **registered doctor**, the event page shows me that I'm registered and how/when I'll join, instead of offering me the register CTA again.
- **US-4** — As a **registered doctor**, I find every event I've registered for in «мои события» in my personal account, with date/time and a way to reach the event page — closing the legacy "I registered but can't find it" gap.
- **US-5** — As an **operator**, every registration is durably recorded against the doctor's account, so the room can admit exactly the registered audience and the sponsor roster is trustworthy.

## Flows

**Happy path — logged-in one-tap (US-1, US-3):**

1. Logged-in doctor on the event page taps «Участвовать».
2. The page immediately reflects the registered state (confirmation + join signposting); the event appears in «мои события».

**Guest through auth (US-2):**

1. Guest taps «Участвовать» on the event page.
2. Guest passes the 003 login/signup flow.
3. On success, registration for the originally chosen event completes and the doctor lands back on that event page in the registered state.

**Return visit (US-4):**

1. Doctor opens «мои события» in the portal account → sees registered upcoming events, nearest first.
2. Doctor taps one → event page (registered state); when the event is live, the path onward to the room (feature 006) is obvious.

**Key branches:**

- Already registered → the page shows the registered state; no duplicate registration is created.
- Event already `live` → registration still works and leads straight toward the room (a doctor joining late is a normal case).
- Event `ended`/`archived` → no registration offered.

## Product acceptance criteria

- A logged-in doctor completes registration in **one action** on the event page.
- A guest completes registration through the 003 auth flow **without losing the event context** — no re-search, no second «Участвовать» tap after login.
- The event page always shows the doctor's true registration state; a registered doctor is never shown the register CTA as if unregistered.
- «Мои события» lists the doctor's registered events with date/time (MSK) and links back to each event page; a just-registered event appears there immediately.
- One doctor + one event = at most one registration, regardless of how many times or through which path they register.
- Registrations are recorded server-side against the authenticated account — they are the basis for room admission (feature 006) and the sponsor roster.

## Out of scope

- Welcome / confirmation emails and reminders (wave 2 — notifications).
- Registration limits, closed/whitelist events, promo codes, paid registration (out of the epic / disabled in legacy).
- The legacy "postponed registration" parking mechanism — superseded by the guest-through-auth flow.
- Room access enforcement itself (feature 006); admin control of open/close registration (feature 007 owns event state).

## Open questions

- Can a doctor cancel a registration in wave 1, and does the sponsor roster distinguish cancelled registrations? (owner)
- Is there any registration cutoff (e.g. registration closes when the event ends), or is register-during-live the only special case? (owner)

## Approved mockup

_To be filled at Stage A by `author-design-mockup` (product-owner choice recorded before implementation)._
