---
title: "event roster"
description: "The set of current registrations for one event — the admission basis the webinar room gates against and the membership basis of the sponsor report."
lang: en
---

# event roster (EventRoster)

**Bounded context:** webinars · **Canonical id:** `event_roster`

The **event roster** is the set of current registrations for one event — the
membership derived from the durable `event_registration` records. It is **owned by
feature 005** (which owns the registration write) and **consumed** by feature 006
for room admission and by the wave-2 sponsor report (005 Read models; 006 Event
Model).

The roster is the **admission basis**: the webinar room admits a caller iff they
are authenticated **and** present in the roster for that event **and** the event is
`live` (006 EARS-1). Because wave 1 has no cancelled state, every roster entry is a
current registration (005 Constraints). The roster is **never** exposed on a public
surface — no registrant PII leaks to feature 004's public endpoints (005 EARS-8;
006 EARS-8; recon §6).

**Related terms:** event_registration, webinar_room, sponsor_report, presence_minutes.

**Sources:** feature 005 requirements Read models + EARS-8
(`apps/docs/content/specs/features/005-event-registration/`); feature 006
Event Model + EARS-1 (`apps/docs/content/specs/features/006-webinar-room/`).
