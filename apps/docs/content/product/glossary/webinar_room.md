---
title: "webinar room"
description: "The server-side-gated portal surface where a registered doctor watches a live broadcast — embed player, live chat over Centrifugo, and heartbeat presence capture."
lang: en
---

# webinar room

**Bounded context:** webinars · **Canonical id:** `webinar_room`

The **webinar room** is the authenticated portal surface (feature 006) where a
registered doctor watches the live broadcast. It composes three things behind one
server-side gate: an **embed player** instantiated from the event's explicit
provider enum (`stream_config`), a **live chat** over Centrifugo, and a
server-authoritative **`presence_heartbeat`** that captures per-doctor minutes.

The gate is **server-side, not a UI wall**: room content — player config, the chat
connection credential, and heartbeat acceptance — is served only to a caller who is
**authenticated ∧ registered (`event_roster`) ∧ the event is `live`**, via a
server-issued `RoomAccess` grant; a direct URL, shared link, or crafted request that
fails any condition is refused server-side (006 EARS-1). A non-admissible caller is
routed truthfully — unauthenticated → auth (003), unregistered → register (005),
event not `live` → the truthful 004 lifecycle state — never a soft wall over the
player (006 EARS-6). The room's open window is exactly the event's `live` state:
the director opening/closing it (007 `OpenRoom`/`CloseRoom`) starts and stops
admission, chat, and heartbeat acceptance (006 EARS-7).

The room **embeds only** — it never transcodes, re-hosts, proxies, DRM-signs,
records, or telemeters the stream (006 EARS-9). It is the MVP-critical surface for
the first live webinar.

**Related terms:** stream_config, presence_heartbeat, event_roster,
event_lifecycle_state, display_name.

**Sources:** feature 006 requirements EARS-1/EARS-2/EARS-6/EARS-7/EARS-9
(`apps/docs/content/specs/features/006-webinar-room/`); ADR-0004 Frontend Stack.
