---
title: "Feature 006 — Webinar room: embed player, live chat, presence capture (PRD)"
description: "Product requirements for the authenticated webinar room in the portal app: external-stream embed player behind an explicit provider enum, live chat over Centrifugo, and server-authoritative heartbeat presence capture that drives the sponsor attendance report. Wave 1 of the Webinars epic; source of the 006 EARS triplet (ADR-0014)."
slug: webinars-006-webinar-room-product
epic: ../../product/webinars/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`006-product-ru.md`](./006-product-ru.md)

> Epic: [Webinars — product brief](../../product/webinars/brief.md) · Wave 1, approved variant A «thin vertical». **The MVP-critical surface for the 2026-07-17 live webinar.**

## Feature summary

The room where a registered doctor actually watches the webinar: an embedded external stream (Rutube or similar — we build **no** transcoding and **no** media server), a live chat, and invisible-to-the-doctor presence capture. Access is **server-side gated** — authenticated **and** registered only; there is no legacy-style soft UI wall over the player. The player is selected by an **explicit provider enum** (e.g. `rutube | youtube`) configured in admin — never by URL-sniffing. Chat rides Centrifugo (already in our stack). Presence is captured from minute one via a **server-authoritative heartbeat** — the room posts an authenticated signal every N seconds, the backend appends it to a durable Postgres table — because per-doctor presence minutes are the sponsor's deliverable; for the first webinar the sponsor report is a manual export from that data.

Room composition for the 2026-07-17 webinar: **embed player + live chat + heartbeat presence.** Polls and question-to-lecturer are wave 2.

## User stories

- **US-1** — As a **registered doctor**, when the webinar is live I enter the room from the event page (or «мои события») and watch the stream without any platform-caused obstacle — the legacy "could not join the broadcast" class is retired.
- **US-2** — As a **doctor in the room**, I read and post messages in a live chat alongside the stream, and see others' messages appear without reloading.
- **US-3** — As a **doctor**, my presence in the room is captured automatically the whole time I watch — I never click anything to "prove" I'm there (presence-confirmation widgets are a wave-2 NMO mechanic, not a wave-1 requirement).
- **US-4** — As a **pharma sponsor**, after the webinar I receive per-doctor actual presence minutes (with contacts) for my report — for the first webinar, produced as a manual export from the captured data.
- **US-5** — As an **unauthenticated or unregistered visitor**, I cannot reach the room content; instead I'm guided to log in / register for the event — enforced by the server, not hidden by the UI.

## Flows

**Happy path — watch live (US-1, US-2, US-3):**

1. The director opens the room (feature 007); the event is `live`.
2. Registered doctor follows the join path from the event page / «мои события» → the room renders: embedded player (configured provider) + live chat.
3. While the doctor stays in the room, the client sends an authenticated heartbeat every N seconds; each beat lands in the append-only presence table with doctor, event, and time.
4. Doctor chats; messages fan out in real time to everyone in the room.

**Access branches (US-5):**

- Unauthenticated visitor hits the room → sent through auth (003), then re-evaluated.
- Authenticated but unregistered doctor hits the room → guided to register (feature 005), then admitted.
- Event not `live` (not yet opened / already closed) → no watchable room; the doctor sees the truthful lifecycle state (feature 004's page states).

**After the broadcast (US-4):**

1. The director closes the room (feature 007) → heartbeats stop being accepted for the event.
2. The captured presence data yields per-doctor minutes; the operator hands the sponsor report over (manual export acceptable for the first webinar).

## Product acceptance criteria

- Room access is **enforced server-side**: only an authenticated, registered doctor receives the room content (player config, chat access, heartbeat acceptance). A direct URL, a shared link, or a crafted request does not bypass the gate.
- The player is instantiated from an **explicit provider enum** stored in the event's stream config; provider values are a closed list (e.g. `rutube`, `youtube`) — never inferred from the URL string.
- Chat is **real-time**: a posted message reaches other room participants without reload (Centrifugo transport); chat is available while the room is open.
- Presence heartbeats are **server-authoritative and durable**: authenticated beats append to a Postgres table with enough fidelity to compute actual per-doctor presence minutes; concurrent tabs do not inflate a doctor's minutes.
- The captured data is sufficient to hand the first webinar's sponsor a per-doctor presence-minutes report via **manual export** — no report UI required in wave 1.
- On 2026-07-17: real doctors watch live in this room end-to-end with **zero platform-caused "could not join" complaints**.

## Out of scope

- Polls, question-to-lecturer, presence-confirmation widgets / «титровальные объекты» (wave 2).
- Auto-NMO accrual (90 min + 2 confirmations) and the auto sponsor report «Отчёт партнёра V2» (wave 2) — wave 1 only captures the data they will need.
- Video transcoding, own media server, DRM / signed playback of the external stream, player-level telemetry (out of the epic's embed frame).
- Recordings archive (wave 2).
- Director controls for opening/closing the room and stream config (feature 007).

## Open questions

- **Player discrepancy** (recon §5, §10-1): the knowledge base says "SDN Player (primary) or rutube"; the Bubble export shows only YouTube + Rutube embeds. Resolve with the webinar operator **before fixing the provider enum values**.
- **Heartbeat cadence** (recon §10-3): the legacy export shows 60 s pings but production may differ; confirm the live cadence before fixing N and the "1 beat = N seconds" math.
- **Certificate artifact** (recon §10-5, wave 2): NMO points only, or a downloadable certificate PDF? Owner call before the wave-2 NMO feature.
- **Sponsor report V2 exact shape** (recon §10-9, wave 2): confirm the exact columns/joins with the owner before building the auto-report; wave 1's manual export only needs the raw minutes.

## Approved mockup

_To be filled at Stage A by `author-design-mockup` (product-owner choice recorded before implementation)._
