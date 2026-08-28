---
"@ds/api": major
---

#1483 (ADR-0016 §5): the taxonomy admin API renames its curated book and serves
the two direction relations #1484's targeting resolution will read.

BREAKING — renamed routes: `/v1/admin/topics*` is now `/v1/admin/directions*`.
The old paths are gone rather than aliased: the shipped surface is one operator
admin whose only client ships from this repo, and a redirect would preserve the
vocabulary the rename exists to retire.

New admin surfaces, with the SAME authz as the existing taxonomy admin routes
(`platform_admin`, recorded in the committed endpoint-authz matrix):

- `/v1/admin/direction-specialties` — link a direction to one entry of the closed
  Минздрав nomenclature, list/read, and retire/restore. There is no PATCH: a link
  has no editable field, and «переставить» a link means retiring it and authoring
  the other one.
- `/v1/admin/direction-adjacency` — author a DIRECTED edge between two directions
  with `kind` + `weight`, edit `kind`/`weight` while active (an edge's ENDS are
  immutable), and retire/restore. A retired edge refuses PATCH with 409.

Writes take an `Idempotency-Key`; the lifecycle transitions take `If-Match` and
answer a stale precondition with 412, exactly like the 012 relation routes.
