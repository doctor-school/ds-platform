---
"@ds/api": minor
---

feat(events): 007 EARS-4 — publish transition (draft → published)

Lands the first **named** lifecycle command of the Webinars event admin (feature
007, EARS-4 + EARS-8): `PublishEvent`.

- `@ds/api` — `POST /v1/admin/events/:id/publish` (`platform_admin` / fast-path,
  EARS-8). It runs through the EARS-7 closed-set guard — publish is **refused
  with a 409 unless the event is in `draft`** (any non-draft origin leaves the
  state untouched) — and, on success, applies the `draft → published` move **and
  appends exactly one** terminal `audit_ledger` row **atomically** in a single
  transaction (`event_type = event.published`, keyed to the acting admin; the
  aggregate id + `from`/`to` in `metadata`, no PD — ADR-0003 §6). Publishing is
  the single visibility signal: the same `EventLifecycleState` write makes the
  event publicly reachable on the 004 event page + upcoming listing and opens 005
  registration gating — one state, no second boolean flag (EARS-9). There is no
  idempotent re-publish (a second publish from `published` is the guard's 409).

The admin publish **action** (stock Refine, offered only from `draft` via
`EventAdminDetail.validTransitions`) and the browser E2E journey are the tracked
integration slice (#595, blocked by EARS-1…7); this handler ships the backend
command + its Vitest e2e. The remaining named transitions (open / close /
archive) are sibling handlers (EARS-5/6).
