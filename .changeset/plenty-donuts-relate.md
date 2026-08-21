---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

012 EARS-6 — retained event↔project relationships with the §3.1 lifecycle-impact gate (#1288)

Additive across four packages, no breaking change to an existing export. This is
the FIRST join vertical of feature 012, so it also authors the shared
preview→confirm seam every later relationship (#1290–#1296) reuses.

- `@ds/db`: the `event_projects` join table — the logical pair unique across
  ACTIVE AND RETAINED rows (a retired relation is RESTORED, same row and id,
  never re-inserted), both FKs `RESTRICT`, the `retired ⇔ deleted_at` CHECK, a
  reverse-direction index for the project-side traversal and the
  `event_projects_audit` mirror. `withAuditContext` / `withRequestAuditContext`
  gained an optional transaction-config passthrough so a confirmation can open
  its transaction SERIALIZABLE.
- `@ds/schemas`: the relationship DTOs — create/list/detail, the two public
  summary shapes with their cursor page envelopes, and the `LifecycleImpact`
  preview contract. Every public DTO is `.strict()`.
- `@ds/api`: `GET/POST /v1/admin/event-projects`, `GET
/v1/admin/event-projects/:id`, its `lifecycle-impact` preview and the
  `retire`/`restore` transitions — fenced idempotency, weak-ETag `If-Match`
  concurrency, a signed single-transition impact token, a SERIALIZABLE
  confirmation and RFC 7807 problems. Plus both public traversals:
  `GET /v1/public/events/:idOrSlug/projects` and
  `GET /v1/public/projects/:idOrSlug/events`. There is no PATCH and no DELETE —
  the join carries no mutable attribute and nothing here is ever physically
  removed.
- `@ds/admin`: the «Проекты» tab on the event card (authoring, retire, restore)
  and the read-only «События» view on the project card, both served by one
  panel. Retiring or restoring a link opens a dialog that first shows WHICH
  public pages the change would affect and only then accepts the confirmation;
  if the situation moved while the operator was reading it, the preview reloads
  instead of the action going through on stale information.

Deploy note: `LIFECYCLE_IMPACT_TOKEN_SECRET` must be set in the production and
stand environments before this ships — the impact service fails closed without
it.
