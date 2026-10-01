---
title: "вид события (event kind)"
description: "An editor-managed dictionary entry — Вебинар, Эфир, Конгресс, Встреча клуба, Мастер-класс and any kind an editor adds — that every event references exactly once, declaring the participation formats it allows."
lang: en
---

# вид события (EventKind)

**Bounded context:** taxonomy · **Canonical id:** `event_kind`

The **event kind** («вид события») is a first-class, editor-managed dictionary
entity (`event_kinds`) with a system-owned slug, a title and a required
non-empty set of allowed participation formats drawn from
`online | offline | hybrid`. Every event references exactly one kind
(`events.kind_id`); the list of kinds is dictionary data, never a list fixed in
code, so an editor adds, renames, re-scopes or retires a kind in the admin with
no code change (012 LD-11, EARS-25…EARS-28).

The seed holds exactly five kinds: Вебинар {online} · Эфир {online} ·
Конгресс {offline, hybrid} · Встреча клуба {online, offline, hybrid} ·
Мастер-класс {offline, hybrid}. The format is checked against the kind when an
event is created or saved; narrowing a kind never rewrites existing events, and
an existing event whose format its kind no longer allows is flagged in the admin
until its next valid save (012 EARS-26). A kind carries **no storefront rule** —
the storefront is chosen by the event_audience alone. Grouping is the project,
not the kind, and a lesson is not an event kind: lessons are content of the
specialty feed (feature 018).

**Related terms:** event, event_audience.

**Sources:** feature 012 requirements LD-11 + EARS-25…EARS-28
(`apps/docs/content/specs/features/012-content-taxonomy/`); feature 019
requirements LD-12 + EARS-17.
