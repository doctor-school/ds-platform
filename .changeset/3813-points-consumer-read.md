---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

The 025 consumer read (EARS-2, EARS-30, #3813): `GET /v1/me/points` returns the caller's `PointsAccount` — Pul available and reserved, Bre, Con and the open advance — folded over the ledger's postings at read time, with Pul as integers in unit `Pul`; a request naming another person is refused with 403.
