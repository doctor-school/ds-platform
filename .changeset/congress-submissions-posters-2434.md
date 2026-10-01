---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/congress-submissions": minor
"@ds/api-client": minor
"@ds/design-system": patch
---

Congress posters on the author's submissions API (046 EARS-18…20, #2434): a
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
