---
"@ds/schemas": minor
"@ds/api": minor
---

017 EARS-2 (LD-3): the doctor storefront serves its four home-hero scale
counters — doctors, specialties, lessons and events per year — from ONE computed
public read, `GET /v1/public/statistics`, carrying a required `computedAt`.

`@ds/schemas` gains the `ScaleStatistics` contract. Each counter is optional and
an ABSENT key means the counter has no available source, so `0` on the wire is
always a measured zero and a missing source is never rendered as one. The
specialties counter binds to `SpecialtyBook.total`, so no surface carries a count
literal. `lessons` has no source on the platform yet and is therefore omitted
from every response rather than stubbed.

Figures are computed off the request path behind a bounded staleness window; no
counter is operator-typed and the read counts no rows.
