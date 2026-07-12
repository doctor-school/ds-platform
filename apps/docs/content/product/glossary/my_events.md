---
title: "«мои события» (my events)"
description: "The authenticated portal surface listing a doctor's registered upcoming events nearest-first — closing the legacy 'registered but can't find it' gap."
lang: en
---

# «мои события» (MyEvents)

**Bounded context:** webinars · **Canonical id:** `my_events`

**«Мои события»** ("my events") is the authenticated portal account surface
(feature 005) that lists a doctor's registered **upcoming** events, nearest first,
each carrying date/time (МСК), title, school/series, and a link back to that event's
page. It closes the legacy "I registered but can't find it" gap: a just-registered
event appears there immediately on the next read, via any registration path
(005 EARS-6/EARS-7).

It is fed by the per-caller `MyEvents` read model — the doctor's registered
`published`/`live` future events, ordered nearest `startsAt` first. Wave 1 ships
**only** the **Предстоящие** tab; the `my-events.dc.html` canvas also shows Записи /
Сертификаты tabs and a specialty filter, but recordings and certificates are wave 2+
(005 Scope → Out of scope). Every date/time renders in `Europe/Moscow` labeled МСК
(005 EARS-11).

**Related terms:** event_registration, event, doctor_guest.

**Sources:** feature 005 requirements EARS-6/EARS-7 + Read models + Scope
(`apps/docs/content/specs/features/005-event-registration/`).
