---
title: "display name"
description: "The doctor's real «Имя и фамилия», collected once just-in-time at first webinar-room entry and stored on the users mirror — served only to the doctor themself."
lang: en
---

# display name

**Bounded context:** identity · **Canonical id:** `display_name`

The **display name** is a doctor's real «Имя и фамилия», introduced by feature 006
to render an initials avatar in the webinar-room header. It is collected **once,
just-in-time** — before the first room entry a doctor without one is prompted a
single time; an empty/whitespace-only value is rejected, and once set the prompt
never reappears (006 EARS-14). Collection is **never** moved into registration,
which keeps its exact current fields — zero added funnel friction on live prod
(owner decision 2026-07-11).

Its **SSOT** is a display-name column on the domain `user_mirror` (`users` table),
written via an authed, self-scoped `SetDisplayName` endpoint (`authenticated` /
`doctor_guest` / `fast-path`); the never-read Zitadel profile placeholder stays
never-read (006 EARS-16). It is served **only to the doctor themself** — no endpoint
exposes another user's name (006 EARS-16). The room-header avatar derives its
initials from this real name; fabricating initials from an email address or a
placeholder is forbidden, and where no name exists no avatar is rendered
(006 EARS-15). The display name **never** flows into chat payloads — chat identity
stays the non-PII author tag (006 EARS-16).

**Related terms:** user_mirror, doctor_guest, webinar_room.

**Sources:** feature 006 requirements EARS-14/EARS-15/EARS-16 + Constraints
(`apps/docs/content/specs/features/006-webinar-room/`).
