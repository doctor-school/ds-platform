---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/congress-submissions": minor
"@ds/api-client": minor
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
sent poster — the birth date («Дата рождения», дд.мм.гггг, «Спрашиваем один
раз — перед первым постером.»), written on blur, with «Укажите дату рождения»
on an empty or impossible day. A holder at or above the age limit sees the
refusal on the poster card with no start and on a poster draft in place of the
send; the birth date stays editable there for correction.
