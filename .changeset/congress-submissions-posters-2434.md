---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/congress-submissions": minor
"@ds/api-client": minor
---

Congress posters on the author's submissions API (046 EARS-18…20, #2434): a
poster draft carries the title, the authors as an oral talk, the goal
(1–1000) and the content (1–3000), with no file field. Migration 0045 adds the
nullable `users.birth_date`, written only by its holder through the new
`PUT /v1/me/birth-date` and shown back to them in the section (`birthDate`).
Starting or sending a poster without a birth date is refused
(`field-invalid` on `birthDate`); a kind with an age limit refuses an account
whose full years on the event's Moscow start day reach it, with an
`age-limit` refusal carrying `{maxAgeYears, eventStartDate, age}` that the
cabinet reads as «Постерные доклады принимают от участников младше {N} лет на
дату начала Конгресса — {дата}. На эту дату вам будет {возраст} лет.». The
section's kinds carry `maxAgeYears`; other kinds are unaffected.
