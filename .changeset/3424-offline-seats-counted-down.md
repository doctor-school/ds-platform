---
"@ds/api": patch
---

#3424: a registration that takes an offline seat (an offline event, or a hybrid event while offline seats remain) now counts `events.seats_left` down by one in the registration's own transaction, under a row lock, so the event page turns «Мест нет» / «Участвовать онлайн» by itself when the last seat is taken and concurrent registrations for the last seat yield exactly one success (the rest get the existing 409 `sold-out`). `seats_left = null` (no limit), online events and repeated registrations take no seat (020 EARS-9 / LD-5).
