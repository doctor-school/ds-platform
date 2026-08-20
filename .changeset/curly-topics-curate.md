---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

012 EARS-3 — curated topic authoring vertical (#1285)

Additive across four packages, no breaking change to an existing export; the
slice consumes the W1a (#1283) taxonomy foundation and the #1284 expert
precedent byte-for-byte rather than forking either.

- `@ds/db`: the `topics` entity — slug grammar CHECK, canonical-UUID exclusion,
  the set-once `first_published_at` trigger, a tombstone-ready
  `content_removed_at` column, the `topics_audit` mirror and a `pg_trgm` GIN
  index over `title`/`slug` for operator search.
- `@ds/schemas`: topic DTOs (create/update/list/detail) — the thinnest of the
  four entities: a title (1–120, trimmed) plus its permanent public identity,
  with `.strict()` refusing the description/media fields a topic does not have.
- `@ds/api`: `GET/POST /v1/admin/topics` and `GET/PATCH /v1/admin/topics/:id`
  — JSON-only writes (no media part anywhere), fenced idempotency,
  ETag/If-Match concurrency, RFC 7807 problems and audit writes.
- `@ds/admin`: the `topics` resource — list on the shared taxonomy list shell,
  tabbed create/detail with «Основное», and the generated-slug preview that is
  editable until the first publication. The data provider's resource map now
  admits a resource with NO file part, so a topic write can never be shaped as
  multipart.
