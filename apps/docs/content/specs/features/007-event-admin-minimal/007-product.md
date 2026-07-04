---
title: "Feature 007 — Minimal event admin: create/edit, stream config, room control, lifecycle (PRD)"
description: "Product requirements for the minimal webinar admin in the admin app (Refine, ADR-0004): create/edit an event, configure the stream link, open/close the live room, and drive the single event state machine. Wave 1 of the Webinars epic; source of the 007 EARS triplet (ADR-0014)."
slug: webinars-007-event-admin-minimal-product
epic: ../../product/webinars/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`007-product-ru.md`](./007-product-ru.md)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical». Admin surfaces live in the `admin` app (Refine, ADR-0004).

## Feature summary

The minimal operator/director tooling that makes the other three features possible: create and edit an event (title, date/time MSK, description, speakers as text/refs, specialties, program PDF, sponsor), configure the stream link with an explicit provider, open and close the live room on air day, and move the event along its lifecycle. The lifecycle is a **single state machine** — `draft → published → live → ended → archived` — replacing the legacy scatter of booleans (`draft` / `published?` / `archive` / `visible_in_rg` / …) that made "is this event visible?" ambiguous. This is deliberately **not** the legacy 11-tab editor or the full director console: no widget authoring, no program constructor (nobody used it — operators upload the final PDF), no reporting UI.

## User stories

- **US-1** — As an **operator**, I create an event ≥1 month ahead with the fields the public page needs — title, date/time (MSK), description, speakers (text or refs), target specialties, program PDF, sponsor — and keep it in `draft` until it's ready to announce.
- **US-2** — As an **operator**, I edit a published event as details settle (the program PDF "often changes" — I upload the final version), and the public page reflects the edit.
- **US-3** — As an **operator/director**, on air day I paste the stream link and pick the provider explicitly, so the room knows exactly which player to embed — no URL guessing.
- **US-4** — As a **director**, I open the live room when the broadcast starts and close it when it ends, and those two actions are what admit viewers and bound the presence capture.
- **US-5** — As an **operator**, I move the event through its lifecycle — publish it, and after the broadcast see it through `ended` to `archived` — with the system offering only the transitions that make sense from the current state.

## Flows

**Happy path — the full arc of one webinar (US-1 → US-5):**

1. ≥1 month out: operator creates the event in admin, fills the base fields, uploads the program PDF → `draft`.
2. Operator publishes → `published`: the event appears on the portal listing and its page goes publicly readable (feature 004); registration opens (feature 005).
3. Air day: director pastes the stream URL + selects the provider (e.g. `rutube`), verifies the config, and **opens the room** → `live`: registered doctors are admitted (feature 006), presence capture runs.
4. Broadcast over: director **closes the room** → `ended`: room admission and heartbeat acceptance stop; presence data is complete for the sponsor handover.
5. Later: operator archives → `archived`: the event leaves public surfaces.

**Key branches:**

- Program PDF replaced after publish → the event page serves the new file (US-2).
- Stream link corrected while `published` (wrong URL pasted) → room config updates before/at open.
- Invalid lifecycle jumps (e.g. `draft → live`, reopening an `archived` event) are not offered.

## Product acceptance criteria

- An operator can create and edit an event in the `admin` app with: title, date + time explicitly in **МСК**, description, speakers (free text and/or references), target specialties, program **PDF**, sponsor/partner.
- Event lifecycle is one field with one closed set of states (`draft → published → live → ended → archived`); the UI offers only valid transitions from the current state — no boolean flags to reconcile.
- Stream configuration = URL + **explicit provider choice from a closed enum**; the room (feature 006) consumes exactly this config.
- «Open room» / «close room» are explicit director actions tied to the `live` / `ended` transitions; closing stops admission and bounds presence capture.
- What admin shows as the event's state is exactly what the portal surfaces reflect (listing visibility, page state, room access) — one source of truth, no drift.
- The minimal path — create → publish → configure stream → open → close — is completable by one operator/director for the 2026-07-17 webinar without developer intervention.

## Out of scope

- Widget / «титровальные объекты» authoring, polls console, question-to-lecturer moderation (wave 2).
- Program constructor (legacy had one; nobody used it — final PDF upload is the real workflow).
- Reporting UI / report export buttons (first webinar's sponsor report is a manual export from presence data — feature 006's data).
- NMO configuration (codes, points, accreditation) — wave 2.
- Speaker directory management, per-event speaker cards with ratings, partner tiers (beyond a simple sponsor reference).
- Admin role hierarchy / manager-scoped lists (legacy RLS branches); wave 1 assumes a small trusted operator group.
- Congress landing blocks, offline events, paid flows (out of the epic).

## Open questions

- Speaker representation depth for wave 1: free text is always enough for the first webinar, but when do refs to real user/speaker records become required? (owner)
- Is `ended → archived` a manual operator action (as in legacy) or time-based? (owner)
- Who exactly holds admin access in wave 1 (operator + director as one trusted group vs distinct roles)? (owner)

## Approved mockup

_To be filled at Stage A by `author-design-mockup` (product-owner choice recorded before implementation)._
