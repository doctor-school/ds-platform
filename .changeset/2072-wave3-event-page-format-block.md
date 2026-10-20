---
"@ds/event-page": minor
"@ds/design-system": major
"@ds/doctor": minor
"@ds/portal": minor
---

Event page wave 3 (#2072), the format block, the seats statement, the social proof and the viewers count on both hosts at once. An offline event's format block states the remaining seats (no ticket, QR or venue lines); a hybrid event shows «Очно / Онлайн» tabs whose active tab is in the page URL (`?mode=offline|online`), survives reload and back, rides into the registration return target and defaults to the participation policy's half; a hybrid event with no seats left opens on «Онлайн» and says «Очных мест не осталось». The sign-up card's proof slot carries «Уже записались N коллег» and, separately, the adjacent specialties; an ended event's meta row states «Эфир прошёл» with the date and «Смотрели N коллег». An ended event's card no longer carries the «Участие · Бесплатно для врача» row, and «Комната эфира откроется за 10 минут до начала» renders only before the start.

`@ds/design-system` (breaking): `eventFormatBlockProps` takes the participation CTA as its new second positional argument (`(view, cta?, copy?)` — an old `(view, copy)` call now passes the copy as the CTA) and returns an `EventFormatModel` instead of `EventFormatBlockProps`, and `EventPageCopy` gains required keys, so a caller-built copy object must add them. `EventFormatBlock` gains the `offline` and `hybrid` kinds and the `EventFormatRoomPanel` / `EventFormatSeatsPanel` panels; the format model is `null` for an ended or hidden event; new `eventSocialProof`, `eventAiredMeta` and `eventViewersMeta` projections; `eventPageTimeParts` also returns `dateWithYear`.
