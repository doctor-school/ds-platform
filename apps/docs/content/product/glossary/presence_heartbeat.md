---
title: "presence heartbeat"
description: "The server-authoritative signal posted immediately on visible entry/re-entry and every N seconds thereafter — each accepted beat appended to durable Postgres."
lang: en
---

# presence heartbeat

**Bounded context:** webinars · **Canonical id:** `presence_heartbeat`

A **presence heartbeat** is the authenticated signal the webinar-room client posts
immediately on entry/re-entry and every **N** seconds while a gated doctor is in a
`live` room **and the room tab is the visible, active tab** (Page Visibility API —
`document.hidden` is false). Each
accepted beat appends one append-only row `(doctor, event, instant)` to a durable
Postgres table (006 EARS-4). Presence is captured from minute one with **no**
doctor-facing "prove you're here" action.

The cadence **N** is server-side config (default **60 s**), delivered to the client
in `RoomConfig`; the presence math is parameterized over N, so an operator-confirmed
different cadence changes config, not the spec or the code (006 Constraints). A
**backgrounded tab** (`document.hidden`) emits no beats — so its minutes do not
count toward the sponsor report — and returning visible emits an immediate beat
before restarting the N-second grid. A still-visible foreground tab keeps beating
if the person physically walks away; without an interactive confirmation the
platform has no truthful signal to distinguish that case. Beats are
**server-authoritative and durable**: accepted only from an
authenticated, gated doctor and appended to Postgres — never a client-trusted count.
The durable append table, not ephemeral Centrifugo presence, is the record behind
per-doctor minutes. The live distinct-doctor counter gives a stopped doctor `2 × N`
of freshness grace before age-out, but that window is **count freshness only** — it
does not award trailing sponsor minutes after the last accepted beat. Beats are
refused once the room closes (event leaves `live`); minutes are computed over the
open window (006 EARS-7).

**Related terms:** presence_minutes, webinar_room, event_roster, sponsor_report.

**Sources:** feature 006 requirements EARS-4/EARS-7 + Constraints
(`apps/docs/content/specs/features/006-webinar-room/`); ADR-0003 §3 (append-only
table).
