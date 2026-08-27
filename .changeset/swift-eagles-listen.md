---
"@ds/doctor": minor
---

017 EARS-4 — the doctor storefront home page gains the specialty catalog
(Stage-A variant Б, built from the vendored canvas): a labelled search field over
the whole Минздрав book, the frequent specialties beneath it as chips, and
«Показать весь список — N» where N is the SERVED book total, never a literal.

All four states of the design's catalog state machine are real: Open with the
frequent set, Filtered as the doctor types (debounced, server-side, matching
anywhere in the name and folding case and ё/е), NoMatch stating so in plain
Russian with the query still editable and «Другое» still reachable, and Expanded
revealing the remainder of the book including «Другое». A skeleton stands in
while the reads are in flight, and a failed read says so in Russian with a
working retry while the rest of the page renders untouched. A failed SEARCH is
its own state, distinct from a failed book: the field, the typed query and the
route to the whole list all stay on screen, the retry re-runs the search itself,
and the frequent specialties are never shown as if they were the matches for
what the doctor typed.

No state opens a modal, paints a backdrop or locks scrolling: the page stays
fully scrollable with no specialty chosen. Choosing and remembering a specialty
is not part of this slice, and nothing on the page claims a choice was saved.
