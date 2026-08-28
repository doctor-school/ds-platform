---
"@ds/admin": minor
---

#1483 (ADR-0016 §5): the admin gains the two direction-relation sections, and the
curated book is called what it is.

- «Направления и специальности» — which Минздрав specialties a direction serves.
  The specialty end is a CLOSED book: it is chosen from the nomenclature, and the
  screen offers no way to author one.
- «Смежность направлений» — which directions count as близкие, as a DIRECTED edge
  with a kind and a weight. The list says so in words, because an operator who
  reads the edge as symmetric would author half the graph they meant to. An
  authored edge's ends are locked; a retired one shows its kind/weight as text
  rather than an edit form the API would refuse.
- The whole «Темы» vocabulary becomes «Направления» — nav, list, form and every
  RU sentence, including gender agreement. This is renamed product copy, not a
  mechanical key swap, and reads as copy.
