---
title: "event lifecycle state"
description: "The single closed state machine (draft → published → live → ended → archived) that is the one source of truth every webinar surface reads."
lang: en
---

# event lifecycle state (EventLifecycleState)

**Bounded context:** webinars · **Canonical id:** `event_lifecycle_state`

The **event lifecycle state** is the single `EventLifecycleState` enum —
`draft → published → live → ended → archived` — that governs an event's
visibility and behaviour across the whole epic. It replaces the legacy boolean
scatter (`draft` / `published?` / `archive` / `visible_in_rg` / …) that made
"is this event visible?" ambiguous (007 Constraints; recon §7d).

There is **one** source of truth: the state feature 007 writes is exactly what
every read surface resolves — listing + page visibility (004), registration
availability (005), and room access (006) — so admin and the portal can never
disagree about an event's state (007 EARS-9). The transition set is **closed**:
the only legal moves are the four forward transitions `draft→published`,
`published→live`, `live→ended`, `ended→archived`. Every other move (backward,
skip, reopen-`archived`, unpublish) is **refused server-side**, not merely hidden
in the admin UI (007 EARS-7). `ended → archived` is a **manual** operator action —
there is no scheduler in wave 1 (LD-2).

Each surface derives its render from this one state: `draft` is not publicly
reachable, `archived` renders the public archived notice (004 EARS-5/EARS-6),
registration is offered only for `published`/`live` (005 EARS-9), and the room is
open exactly while the event is `live` (006 EARS-1/EARS-7).

**Related terms:** event, webinar_room, event_registration, stream_config.

**Sources:** feature 007 requirements EARS-7/EARS-9 + Constraints
(`apps/docs/content/specs/features/007-event-admin-minimal/`); feature 004
requirements EARS-4/EARS-5/EARS-6.
