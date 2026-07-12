---
title: "stream config"
description: "An event's player configuration — an explicit provider from the closed enum rutube | youtube plus an embed reference — from which the room instantiates the player, never by URL-sniffing."
lang: en
---

# stream config (StreamConfig)

**Bounded context:** webinars · **Canonical id:** `stream_config`

The **stream config** is an event's player configuration: `{ provider ∈ {rutube,
youtube}, embedRef }`. The provider is chosen **explicitly** from a **closed enum**
and the embed reference is the provider-scoped stream id — never a URL to be
sniffed. It is authored in feature 007 (`ConfigureStream`) and consumed by feature
006, which instantiates the room's embed player from **exactly this config** and
**never** infers the provider from the URL string — the legacy URL-sniffing mistake
that this closed enum retires (007 EARS-3; 006 EARS-2; recon §5).

An unknown or absent provider yields a truthful "stream unavailable" room state, not
a guessed embed (006 EARS-2). The config is correctable while the event is
`published` (007 EARS-3). Extending the enum beyond `rutube | youtube` later (e.g.
SDN Player) is an additive **migration**, not a shape wave 1 pre-builds (owner
decision 2026-07-06). The `stream_config` row lives in Postgres via Drizzle
(ADR-0003).

**Related terms:** event, webinar_room, event_lifecycle_state.

**Sources:** feature 007 requirements EARS-3 + Constraints
(`apps/docs/content/specs/features/007-event-admin-minimal/`); feature 006
requirements EARS-2 (`apps/docs/content/specs/features/006-webinar-room/`).
