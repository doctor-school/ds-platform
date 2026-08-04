---
title: "presence minutes"
description: "Per-doctor heartbeat-covered minutes derived from append-only beats — the sponsor deliverable, concurrent-tab-coalesced and parameterized over N."
lang: en
---

# presence minutes

**Bounded context:** webinars · **Canonical id:** `presence_minutes`

**Presence minutes** are the per-doctor heartbeat-covered minutes for an event,
computed from append-only `presence_heartbeat` timestamps — the sponsor deliverable
that reports which doctor identity emitted accepted beats and for how much covered
time (006 EARS-5), without claiming physical-attention proof. For the first
webinar the sponsor report is a **manual export** from this data; there is no report
UI in wave 1.

Two properties are load-bearing. The derivation is **parameterized over N** (the
server heartbeat cadence, default 60 s) — a different confirmed cadence recomputes
minutes without a code change. And **concurrent tabs do not inflate** a doctor's
minutes: beats from a doctor's parallel sessions for the same event coalesce into
one presence timeline, so two tabs open in the same minute count as one minute
(006 Constraints; EARS-5). The live counter is a **separate derivation** from the
same durable beat source: it keeps the latest accepted beat fresh for `2 × N`, but
that count-only grace awards **zero additional sponsor minutes** after the last
accepted beat. A hidden tab emits no beats; returning visible emits one immediately.
A still-visible tab continues accruing beat buckets even if the person physically
walks away because wave 1 has no truthful interactive confirmation signal. Minutes
are computed over the window the room was open — beats stop being accepted once the
room closes (006 EARS-7). The auto-NMO accrual
(90 min + confirmations) and the auto sponsor report «Отчёт партнёра V2» that will
consume these minutes are wave 2 (006 Scope → Out of scope).

**Related terms:** presence_heartbeat, sponsor_report, event_roster, webinar_room.

**Sources:** feature 006 requirements EARS-5/EARS-7 + Outcomes
(`apps/docs/content/specs/features/006-webinar-room/`).
