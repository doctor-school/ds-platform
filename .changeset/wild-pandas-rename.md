---
"@ds/db": major
---

#1483 (ADR-0016 §2.8/§5): the curated `topics` book becomes `directions`, and the
schema gains the two relations the 017 targeting resolution reads.

BREAKING — a renamed table and renamed exports: `topics` → `directions`, with
every exported symbol renamed to match. ADR-0016 §5 also names an `event_topics`
join as following the rename; no such table exists in the shipped schema (events
carry no direction join yet), so nothing was renamed for it.

The rename is hand-written as a true SQL `RENAME` over the drizzle-kit diff —
the generator offers only DROP + CREATE for a renamed table — and it renames every
dependent constraint, index and trigger with it, so the
retained-row lifecycle (`record_status`, #1278) and every existing row survive
it; nothing is dropped and re-created.

New: `direction_specialties` (directions ↔ the closed Минздрав nomenclature) and
`direction_adjacency` (a DIRECTED self-relation carrying `kind` + `weight`), both
with RESTRICTIVE foreign keys (ADR-0003) and the same lifecycle columns as every
other retained-row table.
