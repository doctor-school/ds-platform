---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
---

017 EARS-3 — the platform gains the closed Минздрав specialty reference book. A new `specialties_minzdrav` table is populated by a provenance-stamped seed from Приказ Минздрава России от 14.05.2026 № 435н (Раздел I, in force from 01.09.2026) plus the single «Другое» catch-all, and served by two public reads: `GET /v1/public/specialties` (the whole book with its own `total` — no count literal exists anywhere) and `GET /v1/public/specialties/frequent` (the ordered frequent subset the search-first catalog renders). `@ds/schemas` gains the `SpecialtyRef` / `SpecialtyBook` / `FrequentSpecialties` contracts, the `SPECIALTY_NOT_IN_BOOK` error code and the reusable `isSpecialtyBookMember` predicate; the book has no write path, and any specialty reference outside it is refused fail-closed with RFC 7807.
