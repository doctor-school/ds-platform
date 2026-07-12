---
title: "event"
description: "The webinar aggregate — the single authored entity (title, schedule, speakers, stream config, lifecycle state) the whole Webinars epic is built around."
lang: en
---

# event (webinar event)

**Bounded context:** webinars · **Canonical id:** `event`

An **event** is the webinar aggregate at the centre of the Webinars epic — one
authored entity that carries everything a broadcast needs: `title`, `school`
(series), a canonical `startsAt` instant, `durationMin`, `description`,
`speakers[]`, target `specialties[]`, backing `partners[]` / sponsor, an optional
program **PDF**, its **stream config**, and its single **event lifecycle state**.
In wave 1 an event is a single webinar broadcast — congresses, offline events,
and paid tiers are out of the epic (004/007 Scope → Out of scope).

The event is **authored by feature 007** (the admin/Refine vertical) and **read**
by the rest of the epic: feature 004 renders its publish-safe `PublicEventPage`
and `UpcomingBroadcastCard` projections, feature 005 registers doctors against it,
and feature 006 opens its room. It is created in `draft` and becomes publicly
reachable only once published (007 EARS-1/EARS-4). The write model — the event
aggregate row plus its `stream_config` row — lives in Postgres via Drizzle; the
program-PDF binary lives in object storage, never in the record (ADR-0003;
007 Constraints).

**Related terms:** event_lifecycle_state, stream_config, event_registration,
webinar_room, sponsor.

**Sources:** feature 007 requirements + Event Model
(`apps/docs/content/specs/features/007-event-admin-minimal/`); feature 004
Event Model (`apps/docs/content/specs/features/004-event-page-listing/`);
ADR-0003 Data Layer.
