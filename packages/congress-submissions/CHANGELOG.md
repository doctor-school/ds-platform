# @ds/congress-submissions

## 0.2.0

### Minor Changes

- [#2676](https://github.com/doctor-school/ds-platform/pull/2676) [`1a6572d`](https://github.com/doctor-school/ds-platform/commit/1a6572de022247474a1209c9ba4f0409ba1b51a4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress cabinet: the list and an editable submission link to the congress site's filling guide «Как заполнить заявку ↗», opening in a new tab (046 EARS-36). The section host now takes `fillingGuideHref`.

- [#2519](https://github.com/doctor-school/ds-platform/pull/2519) [`3ae7607`](https://github.com/doctor-school/ds-platform/commit/3ae7607a52c1143dcd1fae78b854ce627cf94b6b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress abstracts on the author's submissions API (046 EARS-21…25, [#2435](https://github.com/doctor-school/ds-platform/issues/2435)): an
  abstract draft carries the title, the authors with no presenting mark and five
  plain-text sections — «Актуальность», «Цель», «Материалы и методы»,
  «Результаты и обсуждение», «Выводы» — each non-empty at send and together at
  most 5000 characters by `abstractLength` (`@ds/schemas`: each section trimmed,
  CRLF as one line break, spaces and line breaks counted), the same function the
  form's counter uses; above it the send is refused (`field-invalid` on `body`
  with `{length, max}`). The send takes the two statements «В тексте нет
  некорректных заимствований» and «В тексте нет торговых наименований»
  (`statements: ["plag", "trade"]`), each missing one refused as
  `statement-required`, and stores them with their instant; publication is
  covered by the one submission consent. With the event's first-author rule on,
  the kind's limit also binds every submitter's counted submissions with the
  same normalised first author (`first-author-limit-reached` with
  `{limit, used, firstAuthor}`). Creating an
  abstract with `derivedFromId` («Подать тезисы по этой работе») copies the title
  and authors of the author's own sent oral talk or poster — not a draft or a
  withdrawn one — and links to it. A submission now carries `derivedFromId` and
  `statements`.

  The cabinet offers abstracts: «Начать заявку» on «Тезисы» opens the abstract
  form — «Название тезисов», the authors in publication order, «Текст тезисов»
  with its five sections and one total counter in the send panel («4 998 /
  5 000», marked from 4 500, «осталось N» / «больше на N») — with the two
  statements before the consent, sent with it. The refusals read in the canvas
  words — «Сократите текст тезисов до 5 000 знаков — сейчас N», «Подтвердите,
  что в тексте нет некорректных заимствований» / «… торговых наименований» —
  and the first-author refusal names the author: «С первым автором «{ФИО}» уже
  отправлено N тезисов из N — эту заявку отправить нельзя.» Like every failed
  send, a refusal at the abstracts' limit or by the first-author rule keeps
  «Текст заявки сохранён.» under it. A sent oral talk or
  poster offers «Подать тезисы по этой работе» in the list and in its detail
  while abstracts can be started; it opens the prefilled abstract draft. Each statement's and the consent's error line is part of its box's
  aria-describedby, like the title and section fields.

- [#2474](https://github.com/doctor-school/ds-platform/pull/2474) [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - «Мои заявки на Конгресс» on the doctor storefront (046 EARS-4…13, 16, 17, [#2433](https://github.com/doctor-school/ds-platform/issues/2433)):
  the new shared `@ds/congress-submissions` section at `/account/congress` — the
  list with status labels and filter, the revision deadline with its countdown,
  the kind choice (every kind with its own intake line; poster and abstracts not
  yet startable), the oral talk
  form with the authors editor and autosave, the send panel with the error summary,
  consent and confirmation, «Забрать на исправление», «Отозвать» and draft deletion.
  Change, send and withdrawal times and the
  autosave stamp are in the viewer's time zone; intake and revision dates stay in
  МСК. A guest is sent to the login and lands back on the section. The account page
  shows the row «Мои заявки на Конгресс» for an account registered for the
  congress. `@ds/design-system`: the account card takes an optional `congressHref`
  row, and `Link` gains the `muted` and `danger` tones, the `caption` size and the
  `semibold` weight (the canvas quiet action, 13px/600); `cn()` keeps the
  `text-lead` size beside a text colour instead of dropping it.

- [#2513](https://github.com/doctor-school/ds-platform/pull/2513) [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress posters on the author's submissions API (046 EARS-18…20, [#2434](https://github.com/doctor-school/ds-platform/issues/2434)): a
  poster draft carries the title, the authors in publication order with no
  presenting mark, the goal (1–1000) and the content (1–3000), with no file
  field. Migration 0045 adds the nullable `users.birth_date`, written only by its
  holder through the new `PUT /v1/me/birth-date` and shown back to them in the
  section (`birthDate`). A poster draft is created without a birth date; sending
  it without one is refused (`field-invalid` on `birthDate`). A kind with an age
  limit refuses an account whose full years on the event's Moscow start day
  reach it — at creation when a birth date is stored, and at send — with an
  `age-limit` refusal carrying `{maxAgeYears, eventStartDate, age}` that the
  cabinet reads as «Постерные доклады принимают от участников младше {N} лет на
  дату начала Конгресса — {дата}. На эту дату вам будет {возраст} лет.». The
  section's kinds carry `maxAgeYears`; other kinds are unaffected.

  The cabinet offers the poster: the kind choice creates the draft. The poster
  form holds the topic, the authors in publication order (no speaker choice, no
  on-site line), «Цель» and «Содержание», and — until the holder has an earlier
  sent poster — the birth date («Дата рождения», the DS date control: a calendar
  day from 1900-01-01 up to today in Moscow, «Спрашиваем один раз — перед первым
  постером.»), written on blur, with «Укажите дату рождения» when it is empty or
  out of that range at send. A holder at or above the age limit sees the
  refusal on the poster card with no start and on a poster draft in place of the
  send; the birth date stays editable there for correction.

  A failed send keeps «Текст заявки сохранён.» under the refusal also when the
  refusal is tied to no field (limit, revision deadline, closed intake).

  `@ds/design-system`: the theme root declares `color-scheme` — `light` on
  `:root`, `dark` under `.dark` — so native control parts (the date picker
  indicator, scrollbars, autofill, select chrome) follow the resolved theme; in
  dark the calendar glyph of a date input was a dark icon on the near-black field.
  Embedded frames keep the UA scheme (`iframe { color-scheme: normal }`): per
  CSS Color Adjust 1 §2.4 a frame whose scheme differs from its document's gets
  an opaque Canvas backdrop, so the inherited `dark` turned the light SmartCaptcha
  challenge into a solid light box over a dark page.

  A cabinet field's error line is referenced by its control's
  `aria-describedby` (topic, «Цель»/«Содержание» and the other text fields, the
  birth date with its hint).

### Patch Changes

- [#2558](https://github.com/doctor-school/ds-platform/pull/2558) [`b00b042`](https://github.com/doctor-school/ds-platform/commit/b00b042452a1323b34e9580035a3ee014597cc82) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Congress cabinet: the chooser note names the concrete intake deadlines instead of «пока приём открыт»; a sent submission's list row shows its send date «отправлена {дата}»; a read-only oral talk no longer prompts «Отметьте одного докладчика».

- [#2737](https://github.com/doctor-school/ds-platform/pull/2737) [`c5b00a4`](https://github.com/doctor-school/ds-platform/commit/c5b00a46231c2505c378df27fc0856f07260483b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 046 revision copy ([#2734](https://github.com/doctor-school/ds-platform/issues/2734)): the needs-revision letter no longer prints a second full stop after a committee comment that already ends with `.` `!` `?` or `…`, and the author's cabinet shows the revision deadline with its year («до 22 декабря 2026, 23:59 МСК»).

- [#2575](https://github.com/doctor-school/ds-platform/pull/2575) [`62d2b68`](https://github.com/doctor-school/ds-platform/commit/62d2b6868967ac0c4494173da3481e3524c219a8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 046 EARS-12: the send confirm and a sent submission state the take-back deadline — the kind's close day («До 15 января 2027 заявку можно забрать на исправление…», «Можно исправить до 15 января 2027») — instead of «пока открыт приём»; a re-send after the kind has closed keeps the final «изменить её будет нельзя».
- Updated dependencies [[`9388284`](https://github.com/doctor-school/ds-platform/commit/9388284e74a18eeb87478fc8ccc405a7caf631c9), [`9388284`](https://github.com/doctor-school/ds-platform/commit/9388284e74a18eeb87478fc8ccc405a7caf631c9), [`5922a37`](https://github.com/doctor-school/ds-platform/commit/5922a373daa5fd617f2b3076cf7ea9be97f4c32b), [`b54d3db`](https://github.com/doctor-school/ds-platform/commit/b54d3dbda91585981f3c29b162049031cd7d3336), [`8350915`](https://github.com/doctor-school/ds-platform/commit/835091584a7a9f2e44a3e5dbbc70bd27e7b17495), [`c9f83ad`](https://github.com/doctor-school/ds-platform/commit/c9f83adaeb194a3d53f33a019c45a2e26ccdb489), [`4f6fb18`](https://github.com/doctor-school/ds-platform/commit/4f6fb1869cbf13a68d7433c7aaf798fac21af4ab), [`f4be8fc`](https://github.com/doctor-school/ds-platform/commit/f4be8fc90d07cd167141150a7c5bbcdf63426a0f), [`406ef0c`](https://github.com/doctor-school/ds-platform/commit/406ef0c73e1ceafe668f77422ad09cae2b3ad298), [`22c8d1e`](https://github.com/doctor-school/ds-platform/commit/22c8d1ef07a7ebf501389b75ae8b1309eb3e0de9), [`de024c9`](https://github.com/doctor-school/ds-platform/commit/de024c9daecee663cc52a498712e7641e18759fb), [`de024c9`](https://github.com/doctor-school/ds-platform/commit/de024c9daecee663cc52a498712e7641e18759fb), [`8c72f43`](https://github.com/doctor-school/ds-platform/commit/8c72f43cd72f8fad78a7952e6e71309ab055b2b0), [`d2f3d91`](https://github.com/doctor-school/ds-platform/commit/d2f3d91dcae0e6be16cb50c9c598dfd000f4a678), [`3f5fb3e`](https://github.com/doctor-school/ds-platform/commit/3f5fb3efc32cb9b49e61662a57e79157e52fc2eb), [`1e18f3f`](https://github.com/doctor-school/ds-platform/commit/1e18f3fcad2965d8494fba1339d170eddc8d06d2), [`1e18f3f`](https://github.com/doctor-school/ds-platform/commit/1e18f3fcad2965d8494fba1339d170eddc8d06d2), [`4016b60`](https://github.com/doctor-school/ds-platform/commit/4016b60050758927b682d76baae9cddbfd2d9330), [`a8eed16`](https://github.com/doctor-school/ds-platform/commit/a8eed16a5c10884386df93c1af1fd650296ef2d9), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`1e9079e`](https://github.com/doctor-school/ds-platform/commit/1e9079e249f094046a38edadc50ae9b8ec709d6e), [`5064784`](https://github.com/doctor-school/ds-platform/commit/506478497fa1b6879a8f26eb60c01db32d145113), [`7f0019a`](https://github.com/doctor-school/ds-platform/commit/7f0019a99e5aa438e65e8b2bbcd6eee4d144d9b6), [`8ae9c15`](https://github.com/doctor-school/ds-platform/commit/8ae9c15f908d94e49a857121c70a4e9390f1ca14), [`247b352`](https://github.com/doctor-school/ds-platform/commit/247b3524c9addd7e7ebf83a19ac8615a79b3e306), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`c754a6d`](https://github.com/doctor-school/ds-platform/commit/c754a6d5a11e8d72ef26d7cc756cc26cafda3977), [`ed94b36`](https://github.com/doctor-school/ds-platform/commit/ed94b36260d4ef98d16a9d8f0f1e1bdbd33c8449), [`dbc5624`](https://github.com/doctor-school/ds-platform/commit/dbc5624ef3cacf00d7fb60119f5045248fe22299), [`87e7143`](https://github.com/doctor-school/ds-platform/commit/87e7143dd89b7d6d9942f7008f92c64899dd8431), [`1853c46`](https://github.com/doctor-school/ds-platform/commit/1853c46b619aa78d69e4da96c6d5e1a7a02d517d), [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d), [`61543e5`](https://github.com/doctor-school/ds-platform/commit/61543e5e9ee265515f5eb49ec136d5fa948422f0), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`096f73f`](https://github.com/doctor-school/ds-platform/commit/096f73ff412db2ac636cd04cb624209e7613da93), [`b1e5396`](https://github.com/doctor-school/ds-platform/commit/b1e5396f7a3516895a1e1dcd10a7fd62090d9f61), [`a4c37d2`](https://github.com/doctor-school/ds-platform/commit/a4c37d24812727cbfad64cd969446b0ee234848a), [`e26551d`](https://github.com/doctor-school/ds-platform/commit/e26551d777b683079f7dbed7f68e9ab8475a4508), [`7bb7040`](https://github.com/doctor-school/ds-platform/commit/7bb7040046f9ee2f2f4f0b3c007918bc9d2cba84), [`3ae7607`](https://github.com/doctor-school/ds-platform/commit/3ae7607a52c1143dcd1fae78b854ce627cf94b6b), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a), [`509bfe2`](https://github.com/doctor-school/ds-platform/commit/509bfe21fa31222013dc78b7d70b78d5e04e51d0), [`b2aff14`](https://github.com/doctor-school/ds-platform/commit/b2aff149c351d8fb23b197d4816f1cb33289385d), [`5734653`](https://github.com/doctor-school/ds-platform/commit/57346537ff53a3e42223da952d86f50f30eb592e), [`026327e`](https://github.com/doctor-school/ds-platform/commit/026327eb09f34c722b68a6a50e0e2b4a3018003c), [`e33baab`](https://github.com/doctor-school/ds-platform/commit/e33baab31e3f594a62470977270848e733a20fcc), [`bb4b540`](https://github.com/doctor-school/ds-platform/commit/bb4b540302e36d4edace761fe5e68e96932cdecd), [`b0d5750`](https://github.com/doctor-school/ds-platform/commit/b0d57504a82e638ebc4475fee62943e90bd85d40), [`bb4b540`](https://github.com/doctor-school/ds-platform/commit/bb4b540302e36d4edace761fe5e68e96932cdecd), [`103c74d`](https://github.com/doctor-school/ds-platform/commit/103c74deb7f6e51c0467c520ebfd1813272000bb), [`1cb4407`](https://github.com/doctor-school/ds-platform/commit/1cb4407ad373d69480b4c8ebded47bb82161912a), [`bc6cc00`](https://github.com/doctor-school/ds-platform/commit/bc6cc0013ce4aeee6fe3b4e990030a7718a0703f), [`f497914`](https://github.com/doctor-school/ds-platform/commit/f4979144b471764dc32748ef614dcd4100dde15e), [`5912916`](https://github.com/doctor-school/ds-platform/commit/5912916deaab5efea847a94fada3f0ea232634b1), [`972ccca`](https://github.com/doctor-school/ds-platform/commit/972ccca5d12e9bbe83f2be7c0c4ca90aa9401e9e), [`82697f8`](https://github.com/doctor-school/ds-platform/commit/82697f8e81fdc31989757c83b93a96547eed06a9), [`e07356d`](https://github.com/doctor-school/ds-platform/commit/e07356d418754d8886f35ad485465fde731907de), [`4053361`](https://github.com/doctor-school/ds-platform/commit/40533617334ba73a7d9e53b3bf6c6af38c56d744)]:
  - @ds/schemas@7.0.0
  - @ds/auth-flow@1.0.0
  - @ds/design-system@6.0.0
