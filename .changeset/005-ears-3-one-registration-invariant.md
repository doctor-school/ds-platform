---
"@ds/db": minor
"@ds/api": minor
---

feat(events): 005 EARS-3 — one-registration invariant + idempotent RegisterForEvent

Enforces the one-registration invariant (realizes US-1, US-5): one doctor + one
event = **at most one** registration, regardless of how many times or through
which path (one-tap, guest-through-auth, «мои события» re-entry) the doctor
registers. A repeat is an **idempotent no-op** returning the existing
registration — no duplicate row, no second `DoctorRegisteredForEvent`, no second
`audit_ledger` entry (design §2/§5; ADR-0003 §5/§6).

- `@ds/db` — `UNIQUE (user_id, event_id)` on `registrations`, migration
  `0008_registrations_unique.sql`. The migration **dedups any pre-existing
  duplicate rows first** (keeping the earliest `registered_at`, tie-broken on the
  lower `id`) before adding the constraint, so it applies cleanly on a database
  where EARS-1's pre-constraint insert could have accumulated duplicates
  (latent-only in pre-pilot). The invariant is enforced in the database, not by
  client discipline.
- `@ds/api` — `RegisterForEvent` is now an idempotent `INSERT … ON CONFLICT
(user_id, event_id) DO NOTHING` + read-back keyed on the constraint, correct
  under the insert-race (one inserts, the other reads back — never a duplicate nor
  a lost registration). On the **first insert only** it appends exactly one
  terminal `audit_ledger` row (`webinar.registration.created`, the durable
  `DoctorRegisteredForEvent`; opaque subject + ids only, no PD), in the same
  transaction as the insert; an idempotent repeat appends none — the
  exactly-one-then-none invariant. Both first insert and repeat return
  `{ registered: true, registeredAt }`.

The terminal audit row is landed here (not EARS-8) because its
exactly-one-on-first-insert / none-on-repeat guarantee is a direct consequence of
the `ON CONFLICT` insert/conflict discrimination that is EARS-3's core — design §5,
the Invariants, and the EARS-3 AC all assign it to the register command's first
insert. EARS-8 (#572) now owns the `EventRoster` read model plus the no-PII
cross-check on top of the record. Built and E2E-driven against seeded fixture
events until feature 007 delivers authoring/transitions (tracked seam, parent
#564).
