# @ds/doctor

## 0.4.0

### Minor Changes

- [#1739](https://github.com/doctor-school/ds-platform/pull/1739) [`98d9509`](https://github.com/doctor-school/ds-platform/commit/98d9509a65216edfd8d6c99a9074b82d011e4cd9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 019 EARS-3 — the day-grouped, specialty-targeted doctor events feed.

  Additive across the chain and breaking nowhere. `@ds/schemas` gains the
  `doctor-events-feed` contract plus the ONE query codec both hosts decode with;
  `@ds/api` serves `GET /v1/storefront/doctor/events` and `@ds/api-client`
  regenerates against it; `@ds/design-system`'s `EventList` widens with the
  optional `tenseControl` / `paginationMode: "none"` / `footer` props a host
  reading a single tense over a bounded horizon needs (every existing caller
  keeps its current behaviour); `@ds/doctor` gains the `/events` route.

- [#1876](https://github.com/doctor-school/ds-platform/pull/1876) [`e926d75`](https://github.com/doctor-school/ds-platform/commit/e926d75c9c71037687fc25de37e41539a3ba3d6d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 §6.1 / 006 EARS-2 ([#1722](https://github.com/doctor-school/ds-platform/issues/1722) slice 3) — the doctor storefront mounts the shared live room at `/events/:slug/room`.

  The room is the same `@ds/room` unit the Academy runs, not a second implementation: this host adds only its session forward, its own upstream base, its own route table (all three refusal branches stay on doctor.school — this host has no login route) and its own RU copy. The route lives in a new `(room)` group so it renders outside the 017 storefront chrome.

  The api's doctor route table now resolves `roomPath`, so a registered doctor on a live event gets `enter-room` with a real target on doctor.school instead of the `href: null` it carried while the route did not exist.

  020 EARS-7 is now delivered whole: the participation CTA carries `presenceCount` — the live count of colleagues already in the room — on `enter-room` and `null` on every other action, read from the SAME distinct-doctor aggregate and the SAME config-derived freshness window the 006 room grant uses. The shared `EventSignupCard` renders it as one plain-RU line («В эфире уже N коллег», correct plural forms), so both storefronts gain it at once.

  The doctor room header now carries the EARS-15 initials avatar (initials from the doctor's real saved display name only), and the room's `register` refusal carries `?from=room` like the Academy's.

  The design system gains the header chip both storefronts wear, so neither host declares it: a new `header` variant on the `Avatar` primitive (the canvas white-on-navy chip — white square, navy ink in both themes, offset `shadow-header-chip` cast, static because the doctor chip is not a link) and a new `@ds/design-system/header-chip` entry point exporting `HEADER_CHIP_SURFACE` (the one surface constant both compose) plus `HEADER_CHIP_BASE` (that surface with the neo-brutalist press chain, for interactive chips). The Academy's profile chip and its shell «Войти» chip now IMPORT `HEADER_CHIP_BASE` instead of declaring it, so the two rooms cannot drift.

  The CTA's `presenceCount` now counts COLLEAGUES: the requesting doctor's own live presence is excluded, because the line reads «В эфире уже N коллег». The 006 in-room header count is unchanged — there the number is the room population and correctly includes the viewer.

- [#1890](https://github.com/doctor-school/ds-platform/pull/1890) [`8c54c06`](https://github.com/doctor-school/ds-platform/commit/8c54c06f7f4ce452eb2665d4680d1ce80fe87ad1) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(019 EARS-12): the doctor feed's guest read path and its registration hand-off

  The registration return-target guard becomes an explicit WHITELIST of declared
  shapes (021 LD-3): 005's `/webinars/<slug>` is unchanged, and a second shape —
  `/events?<feed query>&resume=<slug>` — lets a guest who chose «Участвовать» on a
  feed card come back to the feed exactly as they left it, on that card. Every
  accepted value is RECONSTRUCTED from the one feed codec's entries, so an
  undeclared parameter can never ride the return target.

  The doctor event card payload now carries its own `slug` beside `href`, and the
  doctor storefront projects a card CTA per viewer: a guest is handed off to
  `/register` with the minted return target, a doctor goes to the event page.

- [#1909](https://github.com/doctor-school/ds-platform/pull/1909) [`2cb756f`](https://github.com/doctor-school/ds-platform/commit/2cb756f48e7ebd1f1ed1fe3d226e93dcc7363111) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 021 EARS-3 — direct arrival on the doctor registration door: no return context is rendered when the doctor came on their own, and the LD-4 landing (019 events feed when a specialty is remembered, storefront home otherwise, never the account page) is resolved on the server and published on the form.

- [#1832](https://github.com/doctor-school/ds-platform/pull/1832) [`439e749`](https://github.com/doctor-school/ds-platform/commit/439e74902873f9c3bb0900e73ad393f7c192be1e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 EARS-1: one shared event page on both storefronts (doctor `/events/[slug]`, academy `/webinars/[slug]`)

- [#1761](https://github.com/doctor-school/ds-platform/pull/1761) [`e254c92`](https://github.com/doctor-school/ds-platform/commit/e254c925b93e451edc4a05c3083f58c3b56151c5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 019 EARS-4 — the month calendar now stands beside the day feed on `/events` at the desktop breakpoint, acting as navigation over the same targeted read: «сегодня» and live days are marked, and selecting a day writes it into the URL and moves the feed body without reloading the shell.

- [#1737](https://github.com/doctor-school/ds-platform/pull/1737) [`222667b`](https://github.com/doctor-school/ds-platform/commit/222667baccba9cfcf0b7671a582f68127db4c99c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 021 EARS-2 — the registration surface shows the doctor what they will return to.

  A doctor who arrives from a content gate (`/register?from=<event>`) now sees that эфир in the left half of the auth split, rendered through the one shared `WebinarCard` unit, and as the background plate above the form on a phone. The card carries no control that navigates back out of the form: `WebinarCard` gains a `navigable` prop whose `false` reading renders the card as a pure context plate — plain title, no CTA, no link or button anywhere in its subtree. With no resolvable return context nothing is rendered in its place.

### Patch Changes

- [#1850](https://github.com/doctor-school/ds-platform/pull/1850) [`dad13c3`](https://github.com/doctor-school/ds-platform/commit/dad13c3628625ef2ac5b67bcb4cc144b299ebb71) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 020 EARS-2 slice 1 — the registration-free decision set. The public event read
  now carries `links: AroundEvent` (school / speaker pages / community), resolved
  per host by one shared resolver from a route table each storefront owns; a
  destination that does not exist has no key at all, so the page renders plain
  text rather than a dead link. The «Программа» section now always renders — the
  PDF download when one is attached, and otherwise an honest lifecycle-specific
  statement instead of an omitted block. «О чём событие», «Программа» and the hero
  kicker move out of the two host routes into shared `@ds/design-system` blocks.

- [#1758](https://github.com/doctor-school/ds-platform/pull/1758) [`68ba282`](https://github.com/doctor-school/ds-platform/commit/68ba2821bfede1afd2d10cef8e62974450e2c889) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 019 EARS-8 ([#1523](https://github.com/doctor-school/ds-platform/issues/1523)): extract the portable event-listing query codec to `packages/schemas/src/events/event-listing-query.schema.ts`. The wire grammar (repeatable-parameter and boolean spelling, drop-unknown, deterministic key order) and the encode/decode round-trip now live in one shared unit; `doctor-events-feed.schema.ts` mounts it with the doctor vocabulary and defaults, and `apps/doctor/lib/events-feed.ts` keeps only the one-line `URLSearchParams` host adapter. `showMoreHref` now widens the horizon THROUGH the codec, so the «показать ещё» link is emitted in field-table order even when the incoming URL carried no `from`/`to` (it previously appended the horizon keys last). No rendered pixel changes — the same URLs decode and re-encode identically.
- Updated dependencies [[`bd198c3`](https://github.com/doctor-school/ds-platform/commit/bd198c33d326750623b73ecea4e9cd6239abab32), [`98d9509`](https://github.com/doctor-school/ds-platform/commit/98d9509a65216edfd8d6c99a9074b82d011e4cd9), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`e926d75`](https://github.com/doctor-school/ds-platform/commit/e926d75c9c71037687fc25de37e41539a3ba3d6d), [`6484a11`](https://github.com/doctor-school/ds-platform/commit/6484a11ff00db3e4ced30227c64ed5b251bf5c4d), [`654f3ba`](https://github.com/doctor-school/ds-platform/commit/654f3baaf2dd8772de1820e2199baa982d539102), [`8c54c06`](https://github.com/doctor-school/ds-platform/commit/8c54c06f7f4ce452eb2665d4680d1ce80fe87ad1), [`f3ad99f`](https://github.com/doctor-school/ds-platform/commit/f3ad99fdf399cf7cfec87292ca2d0ed22fb34cfc), [`04fa58f`](https://github.com/doctor-school/ds-platform/commit/04fa58f9dcbbc0131e30bdb3cd0bb52413c05d9d), [`d565d04`](https://github.com/doctor-school/ds-platform/commit/d565d049c4597b7ab2e30d34ec673f110abcfaf7), [`d32a070`](https://github.com/doctor-school/ds-platform/commit/d32a07089ea8b9c36f8cb085cc610d238042a70e), [`9ea994f`](https://github.com/doctor-school/ds-platform/commit/9ea994fb52a731be7a183181f8753367386de3bf), [`8f5ea39`](https://github.com/doctor-school/ds-platform/commit/8f5ea39ead9446fef812425d5f4e3ae9bd723495), [`29aca1e`](https://github.com/doctor-school/ds-platform/commit/29aca1efe2e468cd5ab02ea87176e5e64ea2c3c6), [`f9d3e5b`](https://github.com/doctor-school/ds-platform/commit/f9d3e5b6eec35814298f2a843b209b60f4fb4177), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`439e749`](https://github.com/doctor-school/ds-platform/commit/439e74902873f9c3bb0900e73ad393f7c192be1e), [`5a8e03f`](https://github.com/doctor-school/ds-platform/commit/5a8e03f0746ffcc3b8fb7260d906785f4b7b9a0e), [`cdd7b52`](https://github.com/doctor-school/ds-platform/commit/cdd7b52c9c64d27c976c08f4060b64f0c54830bd), [`dad13c3`](https://github.com/doctor-school/ds-platform/commit/dad13c3628625ef2ac5b67bcb4cc144b299ebb71), [`dfe3a50`](https://github.com/doctor-school/ds-platform/commit/dfe3a5098073a4d57d4656d21dd8e5b801748970), [`c734f7b`](https://github.com/doctor-school/ds-platform/commit/c734f7b8df04c6514550da38894ffd681f702f86), [`222667b`](https://github.com/doctor-school/ds-platform/commit/222667baccba9cfcf0b7671a582f68127db4c99c), [`68ba282`](https://github.com/doctor-school/ds-platform/commit/68ba2821bfede1afd2d10cef8e62974450e2c889)]:
  - @ds/design-system@5.4.0
  - @ds/schemas@6.0.0
  - @ds/room@0.1.0

## 0.3.1

### Patch Changes

- [#1682](https://github.com/doctor-school/ds-platform/pull/1682) [`c64dafe`](https://github.com/doctor-school/ds-platform/commit/c64dafe79269c5ad97146cb798e7b537423025ad) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - `/register` renders as a chromeless auth frame: no storefront header, navigation or footer, wordmark above the form column and the card centred on the vertical axis, per the `auth` canvas `#d-register` composition. The route moves into an `(auth)` route group and composes a doctor-local `AuthShell` over the design-system `AuthLayout` block.
- Updated dependencies [[`f8cb3f9`](https://github.com/doctor-school/ds-platform/commit/f8cb3f93c6c2512433a5840afcbdbbb0ef28a712), [`ea28861`](https://github.com/doctor-school/ds-platform/commit/ea2886168662925eb58ad522633e4a9f2bca40da), [`77d8a33`](https://github.com/doctor-school/ds-platform/commit/77d8a3369f6e5fb0cd4d8e6d2df692367d76c793), [`e987b7c`](https://github.com/doctor-school/ds-platform/commit/e987b7cb853b614bef9f901b9dba7adfd3db233b)]:
  - @ds/schemas@5.0.0
  - @ds/design-system@5.3.0

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
