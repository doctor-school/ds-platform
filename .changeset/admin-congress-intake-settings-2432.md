---
"@ds/admin": minor
"@ds/db": minor
---

A platform administrator edits an event's congress intake settings in the admin
(046 EARS-2/EARS-3, #2432): «Приём материалов Конгресса» on the event detail
opens `/events/:id/congress-intake` — registration address, first-author rule,
last revision day, and per kind (oral, poster, abstracts) the opening day, the
last day, the limit and the age limit, as Moscow calendar days. An event
without settings opens on the product defaults; a server refusal lands on its
field in Russian. The golden seed configures the upcoming эфир as a congress
(oral and poster open, abstracts announced).
