---
"@ds/schemas": minor
"@ds/api": minor
---

017 EARS-8: storefront targeting now resolves from the chosen closed-book
specialty through active managed specialty-to-direction links and directed
adjacency edges.

`@ds/schemas` gains the shared `TargetingSet` contract. Own and adjacent
directions carry explicit roles, adjacent rows retain their authored kind and
weight, and «Другое» is represented as an explicit general, non-targeted
selection with Russian explanatory copy rather than an empty targeted result.

`@ds/api` exports the read-through `TargetingService` for subsequent storefront
blocks. It excludes retired rows, reverse-only edges and inferred relations,
orders by authored weight with a stable tie-break, and de-duplicates a direction
reached from multiple own directions without ever re-labelling an own direction
as adjacent.
