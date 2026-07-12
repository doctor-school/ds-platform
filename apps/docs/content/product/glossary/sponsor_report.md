---
title: "sponsor report"
description: "The attendance report a sponsor receives after a webinar — in wave 1 a manual export of the per-doctor presence minutes; the automated «Отчёт партнёра V2» is wave 2."
lang: en
---

# sponsor report

**Bounded context:** webinars · **Canonical id:** `sponsor_report`

The **sponsor report** is the attendance report a `sponsor` receives after a
webinar: which registered doctors attended and for how long, drawn from the
`event_roster` (membership) and the per-doctor `presence_minutes` (attendance
derived from the durable heartbeat beats).

In **wave 1** the report is a **manual export** from the captured presence data —
there is **no report UI** and no report-export button in either the room (006) or
the admin (007) (006 EARS-5; 007 Scope → Out of scope). The wave-1 data need is only
the raw per-doctor minutes, sufficient to produce the first webinar's report by hand.
The **automated** report — «Отчёт партнёра V2», with the auto-NMO accrual it builds
on — is a named **wave 2** vertical; wave 1 only **captures** the data those
verticals will consume (006 Scope → Out of scope). The exact V2 shape (columns /
joins) is a deferred wave-2 open question.

**Related terms:** presence_minutes, event_roster, sponsor, presence_heartbeat.

**Sources:** feature 006 requirements EARS-5 + Outcomes + Scope
(`apps/docs/content/specs/features/006-webinar-room/`); feature 007 Scope → Out of
scope (`apps/docs/content/specs/features/007-event-admin-minimal/`).
