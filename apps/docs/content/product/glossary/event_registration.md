---
title: "event registration"
description: "The durable server-side record that one doctor is registered for one event — the basis for room admission and the sponsor roster, at most one per (doctor, event)."
lang: en
---

# event registration

**Bounded context:** webinars · **Canonical id:** `event_registration`

An **event registration** is the durable record, held server-side against the
authenticated account, that a doctor has registered for a webinar. It is the
write side of feature 005 and the basis for room admission (006) and the
trustworthy sponsor roster (005 EARS-8).

The **one-registration invariant** holds: one doctor + one event yields **at most
one** registration, regardless of path (logged-in one-tap, guest-through-auth, or
«мои события» re-entry) or repeats — enforced by a database uniqueness constraint
on `(user_id, event_id)`, not client discipline; a repeat register is an
idempotent no-op returning the existing registration (005 EARS-3). Registration
is offered while the event is `published` (upcoming) or `live` and refused for
`ended`/`archived` (005 EARS-9). Every registration row is **current** — in wave 1
there is no cancelled state, no soft-delete, and no cancel affordance; cancellation
is a wave-2 vertical (005 Constraints).

The record carries only the `(doctor, event, registeredAt)` fact; no registrant PII
is ever exposed on a public surface (005 EARS-8). The guest-through-auth path
carries the safe event context (event slug + same-origin return target only) through
the shipped 003 auth flow and completes the same registration on return (005 EARS-2).

**Related terms:** event, event_roster, my_events, doctor_guest, webinar_room.

**Sources:** feature 005 requirements EARS-1/EARS-2/EARS-3/EARS-8/EARS-9
(`apps/docs/content/specs/features/005-event-registration/`); ADR-0003 §5
(idempotent-command discipline); ADR-0001 §1 (`doctor_guest`).
