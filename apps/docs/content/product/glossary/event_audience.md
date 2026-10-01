---
title: "аудитория события (event audience)"
description: "The required doctors | experts attribute of every event — the only selector of the storefront that shows it: doctors → the doctor storefront and the app, experts → the Academy."
lang: en
---

# аудитория события (EventAudience)

**Bounded context:** taxonomy · **Canonical id:** `event_audience`

The **event audience** («аудитория события») is the required attribute
`doctors | experts` that every event carries, independent of its kind and its
participation format. It is the **only** selector of the storefront that shows
the event: `doctors` places it on the doctor storefront — the web Витрина Врача
and the mobile app, which read the same set — and `experts` on the Academy, the
backstage, business-oriented content for market experts (012 LD-12, EARS-29).
A given event shows on exactly one storefront, and no event kind carries a
storefront rule.

A project carries a required **default audience** that prefills the audience of
a new event linked to it; the editor may override it per event, and a later
change of the project default never rewrites existing events (012 EARS-30).
The selection is server-side: each storefront's read contract reads only its
audience, never the whole set filtered in the client (019 LD-11).

**Related terms:** event, event_kind.

**Sources:** feature 012 requirements LD-12 + EARS-29/EARS-30
(`apps/docs/content/specs/features/012-content-taxonomy/`); feature 019
requirements LD-11 + EARS-16.
