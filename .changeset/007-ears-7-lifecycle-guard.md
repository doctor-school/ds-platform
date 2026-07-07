---
"@ds/schemas": minor
"@ds/api": minor
---

feat(events): 007 EARS-7 — single closed-set lifecycle state machine (server-enforced guard)

Lands the heart of the Webinars event admin (feature 007, EARS-7 + EARS-8): the
single `EventLifecycleState` state machine with a server-enforced closed
transition set, built on the `LIFECYCLE_TRANSITIONS` SSOT shipped by EARS-1.

- `@ds/schemas` — the closed-set guard predicate `canTransition(from, to)` (the
  single source the read-side `validTransitions` and the server guard both derive
  from) and the `TransitionEventRequest` command body (`{ to }`, constrained to
  the closed lifecycle enum).
- `@ds/api` — `POST /v1/admin/events/:id/transition` (`platform_admin` /
  fast-path, EARS-8): applies a move only if it is one of the four legal forward
  transitions `draft→published→live→ended→archived`; every invalid jump (a
  skip-forward, any backward move, reopening `archived`, the `published→draft`
  unpublish the PRD names none, or a self-transition) is refused server-side with
  a 409 state conflict and the state is never mutated; a target outside the
  closed enum is a 400. The bare guarded transition every named command
  (EARS-4/5/6) runs through — those layer their product side-effects + audit rows
  on top.

The named transition commands (publish / open / close / archive) with their
side-effects + `audit_ledger` rows, and the stock-Refine admin lifecycle actions

- browser E2E, are sibling handlers (EARS-4/5/6, integration slice #595).
