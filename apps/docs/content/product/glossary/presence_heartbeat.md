---
title: "presence heartbeat"
description: "The server-authoritative signal a live-room client posts every N seconds while its tab is visible — each accepted beat appended to a durable Postgres table."
lang: en
---

# presence heartbeat

**Bounded context:** webinars · **Canonical id:** `presence_heartbeat`

A **presence heartbeat** is the authenticated signal the webinar-room client posts
every **N** seconds while a gated doctor is in a `live` room **and the room tab is
the visible, active tab** (Page Visibility API — `document.hidden` is false). Each
accepted beat appends one append-only row `(doctor, event, instant)` to a durable
Postgres table (006 EARS-4). Presence is captured from minute one with **no**
doctor-facing "prove you're here" action.

The cadence **N** is server-side config (default **60 s**), delivered to the client
in `RoomConfig`; the presence math is parameterized over N, so an operator-confirmed
different cadence changes config, not the spec or the code (006 Constraints). A
**backgrounded tab** (`document.hidden`) emits no beats — so its minutes do not
count toward the sponsor report — and the loop resumes when the tab is visible
again. Beats are **server-authoritative and durable**: accepted only from an
authenticated, gated doctor and appended to Postgres — never a client-trusted count.
The durable append table, not ephemeral Centrifugo presence, is the record behind
per-doctor minutes. Beats are refused once the room closes (event leaves `live`);
minutes are computed over the open window (006 EARS-7).

**Related terms:** presence_minutes, webinar_room, event_roster, sponsor_report.

**Sources:** feature 006 requirements EARS-4/EARS-7 + Constraints
(`apps/docs/content/specs/features/006-webinar-room/`); ADR-0003 §3 (append-only
table).
