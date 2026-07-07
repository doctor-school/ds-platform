---
"@ds/api": minor
---

feat(events): 007 EARS-6 — manual archive transition (ended → archived)

Lands the operator's manual post-broadcast archive command of the Webinars event
admin (feature 007, EARS-6 + EARS-8): `ArchiveEvent`.

- `@ds/api` — `POST /v1/admin/events/:id/archive` (`ArchiveEvent`,
  `ended → archived`), `platform_admin` / fast-path (EARS-8). It runs through the
  EARS-7 closed-set guard on the shared `namedTransition` path — archive is
  **refused with a 409 unless the event is in `ended`** (any other origin leaves
  the state untouched and writes no audit row) — and, on success, applies the
  move **and appends exactly one** terminal `audit_ledger` row **atomically**
  (`event_type = event.archived`, keyed to the acting admin; the aggregate id +
  `from`/`to` in `metadata`, no PD — ADR-0003 §6). After archive the event
  **leaves all public surfaces** off the single `EventLifecycleState` (EARS-9):
  004's upcoming listing drops it by state and its public event page degrades to
  the archived-notice body (a **200**, never a dead 404 — the notice rendering is
  the consumer slice 004 EARS-5). `archived` is **terminal** — no reopen (EARS-7).

Archive is manual by design — **LD-2**: wave 1 carries **no scheduler and no
time-based automation** that could fire the transition (a source-scan test
asserts no timer primitive exists in the events module); a time-based
auto-archive policy is a named wave-2 candidate. The admin archive **action**
(stock Refine, offered only from `ended` via `EventAdminDetail.validTransitions`)
and the browser E2E journey are the tracked integration slice (#595); this
handler ships the backend command + its Vitest e2e.
