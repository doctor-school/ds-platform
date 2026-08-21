---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

012 EARS-4 — descriptive partner authoring vertical (#1286)

Additive across four packages, no breaking change to an existing export; the
slice consumes the W1a (#1283) taxonomy foundation and the #1284 expert
precedent byte-for-byte rather than forking either.

- `@ds/db`: the `partners` entity — slug grammar CHECK, canonical-UUID
  exclusion, the `partners_website_url_https` CHECK that admits only `https://`
  addresses, the set-once `first_published_at` trigger, the `partners_audit`
  mirror and a `pg_trgm` GIN index over `title`/`slug` for operator search.
- `@ds/schemas`: partner DTOs (create/update/list/detail) — a title, an optional
  https-only website address and the permanent public identity, with `.strict()`
  refusing the bio/description fields a partner does not have. The website
  validator is a single exported pattern, the exact twin of the DB CHECK, so one
  rule governs both edges.
- `@ds/api`: `GET/POST /v1/admin/partners` and `GET/PATCH /v1/admin/partners/:id`
  — multipart `logo` through the shared still-image normalizer, fenced
  idempotency, ETag/If-Match concurrency, RFC 7807 problems and audit writes.
- `@ds/admin`: the `partners` resource — list on the shared taxonomy list shell,
  tabbed create/detail with «Основное», the generated-slug preview that is
  editable until the first publication, and the logo dropzone with upload /
  replace / clear. Unlike an expert, a partner has no initials fallback: an
  empty logo slot stays empty, because a partner's mark is the brand's, not a
  derivation of its name.
