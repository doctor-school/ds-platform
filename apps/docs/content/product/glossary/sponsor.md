---
title: "sponsor"
description: "The pharma partner backing a webinar (the epic's B2B side) — the party whose external stream the room embeds and who receives the attendance roster and presence-minute report."
lang: en
---

# sponsor (partner)

**Bounded context:** webinars · **Canonical id:** `sponsor`

A **sponsor** is the pharma partner backing a webinar — the B2B side of the
Doctor.School model (a pharma sponsor reaching a B2D doctor audience). An event
carries a sponsor/partner reference authored in feature 007 (007 EARS-1), and the
event page surfaces the backing partners in its public decision set (004 EARS-2).
"Sponsor" and "partner" name the same party from the commercial and the page-content
angles respectively.

The sponsor is the party whose **external stream** the webinar room embeds — the
room composes an iframe/player around the sponsor's stream and nothing more, never
transcoding or re-hosting it (006 EARS-9). The sponsor is also the recipient of the
attendance deliverables: the trustworthy **`event_roster`** (who registered) and the
per-doctor **`presence_minutes`** exported as the **`sponsor_report`** (who watched,
and for how long). Registrant PII in those deliverables never leaks to a public
surface (005 EARS-8; 006 EARS-8).

**Related terms:** event, sponsor_report, event_roster, presence_minutes.

**Sources:** feature 007 requirements EARS-1
(`apps/docs/content/specs/features/007-event-admin-minimal/`); feature 004
requirements EARS-2; feature 006 requirements EARS-9; AGENTS.md §1 (B2B pharma →
B2D doctor model).
