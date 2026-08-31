# @ds/doctor

## 0.3.0

### Minor Changes

- [#1577](https://github.com/doctor-school/ds-platform/pull/1577) [`2d76e79`](https://github.com/doctor-school/ds-platform/commit/2d76e794ab7ef5d6ea937f2755d9819ef833042e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 017 EARS-6 / EARS-7 — the doctor storefront now REMEMBERS the specialty a doctor
  picks, and the home page opens targeted on every visit after the first.

  Activating an entry is the whole command: there is no confirm, no draft and no
  save control to reach afterwards, from the pointer or from the keyboard. The
  catalog collapses to the row the canvas draws — the official name verbatim,
  «Другое» included, a «сменить» control, and the line explaining that content is
  picked by the chosen specialty and its adjacent fields. The row is drawn from
  what the write RETURNED, never from the chip that was clicked, so the page can
  only ever name a specialty the platform actually recorded.

  A refusal claims nothing: the catalog stays open and fully usable, says in plain
  Russian that the choice was not remembered, and the doctor simply chooses again.
  «сменить» restores the FULL variant-Б catalog — the search field over the whole
  book, the frequent set and the route to «Другое» — and re-choosing re-targets and
  is remembered in turn.

  The remembered choice is resolved on the server, so a return visit's first byte
  of HTML is already the collapsed row rather than the catalog folding itself away
  a moment after it painted. When that read cannot be answered the section holds
  its loading render and re-issues the read from the browser instead of re-asking a
  question the doctor has already answered. Nothing here gates the page: no modal,
  no backdrop, no scroll lock, and the rest of the home page stays whole.

### Patch Changes

- [#1664](https://github.com/doctor-school/ds-platform/pull/1664) [`521a541`](https://github.com/doctor-school/ds-platform/commit/521a5416892613f661ebb94fab90df3810ab3484) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 021 EARS-1 — the doctor registration route (`doctor.school/register`) inside the
  017 storefront shell: the `auth` canvas's split composition, exactly three fields
  (рабочая почта, пароль, необязательный промокод) and no document requested at the
  door (REQ-22). Additive route on a private app whose host cut-over has not
  happened, and no existing export or behaviour changes — patch.
- Updated dependencies [[`de51447`](https://github.com/doctor-school/ds-platform/commit/de5144764860d6e3c009330d7ea4d667316be367), [`3833f11`](https://github.com/doctor-school/ds-platform/commit/3833f1177f9fc93d47cdc75469582069a0eb9a4b), [`1ec641e`](https://github.com/doctor-school/ds-platform/commit/1ec641e59b849a2e728c4bdbfdf7486a31fd6825), [`3a13d7c`](https://github.com/doctor-school/ds-platform/commit/3a13d7cca9ec57062a8c102ef811471a7eb86651), [`89e24a2`](https://github.com/doctor-school/ds-platform/commit/89e24a2b49f59887977271210b7ea5b333e339ad), [`e1b771f`](https://github.com/doctor-school/ds-platform/commit/e1b771fdeddc55990c67a5f903aba280d7d174b4), [`2d76e79`](https://github.com/doctor-school/ds-platform/commit/2d76e794ab7ef5d6ea937f2755d9819ef833042e), [`16dfd8b`](https://github.com/doctor-school/ds-platform/commit/16dfd8bb0388caff1a91032ee44d6c3ade0528ad), [`2883a90`](https://github.com/doctor-school/ds-platform/commit/2883a90d978fe1aa51edcb409ef9984fabdc585e), [`f9b61ce`](https://github.com/doctor-school/ds-platform/commit/f9b61ce678f906c31abcba507f3eff8e639e2c54), [`ba859b3`](https://github.com/doctor-school/ds-platform/commit/ba859b3d90fe7a9436dd677f92045ccbd79e8dbb), [`9ee8b78`](https://github.com/doctor-school/ds-platform/commit/9ee8b78b7b3c575a5cf8ae425517040baaaf8cae), [`dc0fcf9`](https://github.com/doctor-school/ds-platform/commit/dc0fcf9f5c7ef1569003552b244be654229c9f06), [`b1533e3`](https://github.com/doctor-school/ds-platform/commit/b1533e318780e09c96689bb7de54283bf09c0e69)]:
  - @ds/design-system@5.2.0
  - @ds/schemas@4.0.0

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
