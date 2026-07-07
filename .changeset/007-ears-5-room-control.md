---
"@ds/api": minor
---

feat(events): 007 EARS-5 — open/close room (published → live → ended)

Lands the director's two air-day lifecycle commands of the Webinars event admin
(feature 007, EARS-5 + EARS-8): `OpenRoom` and `CloseRoom`.

- `@ds/api` — `POST /v1/admin/events/:id/open` (`OpenRoom`, `published → live`)
  and `POST /v1/admin/events/:id/close` (`CloseRoom`, `live → ended`), both
  `platform_admin` / fast-path (EARS-8). Each runs through the EARS-7 closed-set
  guard on the shared `namedTransition` path — open is **refused with a 409
  unless the event is in `published`**, close **unless it is in `live`** (any
  other origin leaves the state untouched and writes no audit row) — and, on
  success, applies the move **and appends exactly one** terminal `audit_ledger`
  row **atomically** (`event_type = event.went_live` / `event.ended`, keyed to
  the acting admin; the aggregate id + `from`/`to` in `metadata`, no PD —
  ADR-0003 §6). Opening the room starts 006 admission of registered doctors +
  presence capture; closing it stops admission + heartbeat/chat acceptance and
  **bounds the presence window** (006 EARS-7). The `live` window is exactly these
  two transitions — the single `EventLifecycleState` 006 gates on, no second flag
  (EARS-9). 006's own admission/heartbeat/chat refusal logic consumes this state
  and is out of scope, as are publish (EARS-4) and archive (EARS-6).

The admin open/close **actions** (stock Refine, each offered only from its valid
state via `EventAdminDetail.validTransitions`) and the browser E2E journey are
the tracked integration slice (#595); this handler ships the backend commands +
their Vitest e2e. `publish()` was refactored onto the same shared
`namedTransition` helper (no behavior change).
