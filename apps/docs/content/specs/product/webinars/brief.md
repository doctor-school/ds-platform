---
title: "Webinars epic — product brief"
description: "Thin product brief for the Webinars epic: sponsor-funded online broadcasts for doctors on the new DS Platform. JTBD, cross-cutting information architecture, wave-1 feature decomposition (approved variant A «thin vertical»), success metrics, and condensed prior art. Source layer for the per-feature PRDs and their EARS triplets (ADR-0014)."
slug: webinars-brief
milestone: https://github.com/doctor-school/ds-platform/milestone/7
parent_issue: https://github.com/doctor-school/ds-platform/issues/471
status: Draft
features:
  - 004-event-page-listing
  - 005-event-registration
  - 006-webinar-room
  - 007-event-admin-minimal
lang: en
---

> **EN (this)** · **RU:** [`brief-ru.md`](./brief-ru.md)

> **Scope (owner decision, brainstorm 2026-07-04).** This epic covers **only webinars — online broadcasts**. Congresses (handed to an external team), offline events, and paid tiers are **explicitly out** — each is a future separate epic. Target: the **2026-07-17** live webinar runs end-to-end on the new platform.

---

## Problem

- Doctor.School's webinar business runs on a legacy Bubble stack that is slow, US-hosted, RKN-throttled, and carries 3 years of tech debt — the rebuild driver (recon §7a).
- The **presence pipeline has been disabled since 2026-04-29** — the core B2B deliverable (per-doctor attendance minutes for the sponsor) cannot be produced for new webinars at all (recon §6).
- Doctors register and then **cannot find the event they signed up for**; login-session races produce "could not join the broadcast" complaints on air day (recon §7c, §7e).
- The next sponsor-funded live webinar is scheduled for **2026-07-17** and must run on the new platform.

## Jobs-to-be-done

- **Pharma sponsor** (pays for everything): get **verifiable reach of a specialty-targeted doctor audience** — a report with contacts + actual minutes of presence per doctor.
- **Doctor:** find a relevant broadcast, register in a couple of clicks, watch live and chat; later — receive NMO credits automatically.
- **Operator / director:** create the event ≥1 month ahead; on air day paste the stream link and open the room; afterwards close it and hand over attendance data.

## Cross-cutting information architecture

- **All viewer surfaces live in the `portal` app** (personal-account app). The event page is **publicly readable** — sponsors distribute direct links through their own channels; that is how discovery works. The CTA «Участвовать» goes through auth (feature 003, already shipped).
- **The webinar room is server-side gated:** authenticated + registered only — no legacy-style soft UI wall over the player.
- **Admin surfaces live in the `admin` app** (Refine, ADR-0004).
- **Event lifecycle is a single state machine** — `draft → published → live → ended → archived` — not the legacy scatter of booleans.
- **Webinar room is built by us as a composition**, with the video as an **external stream (Rutube or similar) embedded as a configured iframe/player** — no video transcoding, no own media server. The Mediator.cloud buy-option was evaluated and **rejected**.
- **Presence is captured from day one** via a **server-authoritative heartbeat** (authenticated POST every N seconds → append table in our Postgres). The sponsor report for the first webinar is a **manual export** from that data; auto-NMO and auto-report are wave 2.

## Feature decomposition

Approved variant **A «thin vertical»** — four wave-1 features, all `surface: user-facing`, each with a co-located PRD:

| #   | Feature                                                                        | One-liner                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 004 | [`event-page-listing`](../../features/004-event-page-listing/004-product.md)   | Public event page (pre-live: hero, date/time, speakers, program PDF, specialties, partners; CTA register) + minimal upcoming-broadcasts listing.          |
| 005 | [`event-registration`](../../features/005-event-registration/005-product.md)   | Registration on top of auth 003 (logged-in one-tap; guest → auth → completes registration), «my events» visibility, registration state on the event page. |
| 006 | [`webinar-room`](../../features/006-webinar-room/006-product.md)               | The authenticated room: embed player (explicit provider enum), live chat (Centrifugo), heartbeat presence capture that drives the sponsor report.         |
| 007 | [`event-admin-minimal`](../../features/007-event-admin-minimal/007-product.md) | Admin/Refine: create/edit event, stream link config, open/close the live room, event state transitions.                                                   |

**Wave 2** (future features of this epic — no PRD folders yet):

- Calendar + specialty facets on the listing.
- Polls + question-to-lecturer in the room.
- Auto-NMO accrual (90 min + 2 presence confirmations).
- Auto sponsor report «Отчёт партнёра V2».
- Notifications (welcome / confirmation / reminders).
- Recordings archive.

**Out of the epic entirely** (future separate epics): congresses, offline events, paid tiers.

## Success metrics

- The **2026-07-17 live webinar runs end-to-end on the new platform**: real doctor registrations → live viewing → presence recorded.
- The first webinar's **sponsor receives a report with presence minutes** (manual export acceptable).
- **Zero «could not join the broadcast» complaints attributable to platform causes** (the legacy session-race class).

## Prior art — source system

The legacy Doctor.School system (Bubble + Directual + Supabase + the business knowledge base + the live site) was mined read-only on 2026-07-02; the full functional evidence — domain model, per-surface functional map, stream/realtime mechanics, the presence pipeline, pain points to beat, and the open-questions register — lives in [`legacy-recon.md`](./legacy-recon.md). In one paragraph: a webinar is a **sponsor-funded broadcast for specialty-targeted doctors**, whose B2B deliverable is a per-doctor attendance report; the legacy implementation proves every capability this epic needs (registration, embedded external player, live chat, presence-minute capture, NMO accrual) while also proving the mistakes to beat — a 130-field event aggregate with a boolean-scatter lifecycle, client-side presence pings with an exposed service key (disabled since 2026-04-29), URL-sniffing player selection, and no-push "realtime". The recon is a look-and-take-the-domain reference, never a target schema or UI (ADR-0014 §3).

### Adopt-vs-build verdicts (recon 2026-07-04)

| Component                                    | Verdict                                | Rationale + source                                                                                                                                                |
| -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole webinar framework                      | **BUILD** (as composition)             | plugNmeet / BigBlueButton / La Suite Meet are WebRTC stacks with own media servers — contradicts the embed frame. (plugnmeet.org, github.com/suitenumerique/meet) |
| Realtime channel (chat, join/leave, widgets) | **ADOPT** Centrifugo                   | Already in our stack; per-channel presence, presence_stats, join/leave, history. (centrifugal.dev/docs/server/presence)                                           |
| Chat UI                                      | **ADOPT** shadcn                       | Official chat primitives (ui.shadcn.com changelog 2026-06) or MIT shadcn-chat (shadcn-chat.vercel.app); final pick at delivery via `build-ui-from-design-system`. |
| Presence storage                             | **BUILD** (small)                      | Centrifugo presence is ephemeral; the sponsor report needs durable minutes → 1 authenticated endpoint + 1 append table.                                           |
| Embed player                                 | **ADOPT** react-player / thin iframe   | react-player for YouTube (github.com/cookpete/react-player); thin iframe for Rutube; **explicit provider enum, never URL-sniffing**.                              |
| Calendar / listing UI                        | **ADOPT** shadcn event-calendar blocks | At delivery (shadcn-event-calendar.vercel.app etc.); wave 1 needs only a minimal listing.                                                                         |
| Director console / admin                     | **ADOPT** Refine                       | Already the admin-app stack (ADR-0004).                                                                                                                           |

---

_This brief is the epic layer of ADR-0014's two-tier product spec: it decomposes, the co-located `NNN-product.md` PRDs carry the user stories, and the EARS triplets are authored from those PRDs — never the other way around._
