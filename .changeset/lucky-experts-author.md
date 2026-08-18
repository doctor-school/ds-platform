---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

012 EARS-2 — expert authoring vertical (#1284)

Additive across four packages, no breaking change to an existing export; the
slice consumes the W1a (#1283) taxonomy foundation byte-for-byte rather than
forking it.

- `@ds/db`: the `experts` entity — slug grammar CHECK, canonical-UUID
  exclusion, the set-once `first_published_at` trigger, a tombstone-ready
  `content_removed_at` column, the `experts_audit` mirror and a `pg_trgm` GIN
  index over `name`/`slug` for operator search.
- `@ds/schemas`: expert DTOs (create/update/list/detail), the shared
  `expertInitials` derivation and the 012 error codes the surface can raise.
- `@ds/api`: `GET/POST /v1/admin/experts` and `GET/PATCH /v1/admin/experts/:id`
  — multipart `photo` through the shared still-image normalizer, fenced
  idempotency, ETag/If-Match concurrency, RFC 7807 problems and audit writes.
- `@ds/admin`: the `experts` resource — list on the shared taxonomy list shell,
  tabbed create/detail with «Основное», the generated-slug preview and the
  deterministic-initials `Avatar` fallback when an expert has no photo. The
  data provider now dispatches its media part off a resource map instead of a
  hardcoded `projects` branch.
