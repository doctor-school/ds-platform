---
"@ds/schemas": minor
"@ds/api": minor
---

feat(events): 007 EARS-2 — edit event + replaceable program PDF (current file served)

Lands the edit handler of the Webinars event admin (feature 007, EARS-2 + EARS-8):

- `@ds/schemas` — `UpdateEventRequest`, the **partial** edit contract: every
  field optional with **no default** (an omitted key leaves the stored value;
  `partnerRef: null` explicitly clears it), and the lifecycle `state` is not a
  field of the edit contract — an edit can never smuggle a state reversal.
- `@ds/api` — `PATCH /v1/admin/events/:id` (`UpdateEvent`), classified
  `authenticated` / `platform_admin` / `fast-path` (EARS-8). Edits an event's
  authored fields at any **pre-archive** state; when a replacement `programPdf`
  rides the same multipart request the stored object reference is **superseded**
  (a fresh, event-scoped key) so the 004 public page serves the **current** file
  and the superseded file is no longer served. The operator never has to
  unpublish to correct a detail — an edit is not a state reversal (the PRD names
  no `published → draft`). An edit to an `archived` event is a 409, an unknown id
  a 404, a malformed field a 400; on any refusal the aggregate is untouched. Like
  create it owes no `audit_ledger` row (that obligation attaches to the lifecycle
  transitions, EARS-4/5/6).

The admin edit **form** (stock Refine, incl. the PDF re-upload affordance) + its
browser E2E are the integration slice (#595); this handler ships the backend
command + its Vitest e2e/unit.
