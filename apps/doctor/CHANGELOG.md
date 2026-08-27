# @ds/doctor

## 0.2.0

### Minor Changes

- [#1572](https://github.com/doctor-school/ds-platform/pull/1572) [`efb730f`](https://github.com/doctor-school/ds-platform/commit/efb730f3fce255c9cbd9eee0de7cfd4ac4791d13) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-2 — the doctor storefront home page gains its hero: the kicker, the
  headline, the sub-line stating that learning is free for the doctor, and the
  evolutionary goal rendered verbatim with no gloss and no readiness marker. Copy
  is transcribed from the vendored canvas, not written for the page.

  Beneath it the four scale counters — doctors, specialties, lessons and events per
  year — render from ONE computed read (`GET /v1/public/statistics`, LD-3), with
  all four states of the design's `dataState` matrix real: counters, a skeleton
  while the read is in flight, a counter whose source is unavailable OMITTED with
  its neighbours still rendering, and — when the read fails — the counters gone
  with the hero copy untouched. No zero ever stands in for a missing figure.

  The page states nothing about who finances a doctor's learning, and carries no
  price, cart, subscription or payment affordance.

- [#1574](https://github.com/doctor-school/ds-platform/pull/1574) [`d2237c2`](https://github.com/doctor-school/ds-platform/commit/d2237c2f75e308574a7e6f1b01f8b3c1fa265a5c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-4 — the doctor storefront home page gains the specialty catalog
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

### Patch Changes

- Updated dependencies [[`efb730f`](https://github.com/doctor-school/ds-platform/commit/efb730f3fce255c9cbd9eee0de7cfd4ac4791d13), [`d2237c2`](https://github.com/doctor-school/ds-platform/commit/d2237c2f75e308574a7e6f1b01f8b3c1fa265a5c)]:
  - @ds/schemas@3.4.0
  - @ds/design-system@5.1.3

## 0.1.1

### Patch Changes

- Updated dependencies [[`f1a6062`](https://github.com/doctor-school/ds-platform/commit/f1a606231c5c3c5ead47465023db479fb4d3b416)]:
  - @ds/schemas@3.3.0
  - @ds/design-system@5.1.2

## 0.1.0

### Minor Changes

- [#1560](https://github.com/doctor-school/ds-platform/pull/1560) [`d862a9b`](https://github.com/doctor-school/ds-platform/commit/d862a9b2f8577a553af29b36cc5f22902cda02d9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-1 / EARS-12 — the doctor storefront gains its single shell layout: a header with the logo, the theme control, the reserved (empty) search slot and exactly one server-resolved action cluster (guest «Войти» + «Регистрация», or the signed-in «Личный кабинет»), plus a footer carrying the «Документы и контакты» links and the one and only crossing into the Academy. The home route now renders inside that shell instead of drawing its own header and footer.

## 0.0.1

### Patch Changes

- Updated dependencies [[`f81468d`](https://github.com/doctor-school/ds-platform/commit/f81468d52165898f8c7b1f0de553917f4d0ed18b), [`2226016`](https://github.com/doctor-school/ds-platform/commit/222601672d17079eb06914a34dd894b6993dc4c3), [`d388a70`](https://github.com/doctor-school/ds-platform/commit/d388a70455b8c04eb9fe69fbb534da2765fe25a5)]:
  - @ds/schemas@3.2.0
  - @ds/design-system@5.1.1
