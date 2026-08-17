---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/design-system": minor
"@ds/admin": minor
"@ds/showcase": patch
---

012 EARS-1 — project authoring vertical (#1283)

Additive across five packages, no breaking change to an existing export:

- `@ds/db`: the `projects` entity, the extended retained `idempotency_keys`
  contract and `media_cleanup_jobs`, all with DB-enforced retained lifecycles.
- `@ds/schemas`: taxonomy DTOs, the exact 012 `errorCode` set, the idempotency /
  ETag protocol helpers and the shared canonical slugifier.
- `@ds/api`: `GET/POST /v1/admin/projects`, `GET/PATCH /v1/admin/projects/:id`,
  the fenced idempotency service, the shared still-image normalizer and the
  durable media-cleanup worker; the object-storage port gains an opt-in
  write-once PUT.
- `@ds/design-system`: two new primitives — `Textarea` (with a
  no-truncation character counter) and `MediaDropzone`.
- `@ds/admin`: the shared taxonomy admin list shell and the tabbed project
  detail/create surfaces.
- `@ds/showcase`: catalogue entries for the two new primitives.
