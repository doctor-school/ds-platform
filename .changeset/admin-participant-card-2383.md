---
"@ds/admin": minor
---

The congress roster opens a participant card and shows seven columns (#2383,
044 EARS-36/EARS-37, admin layer). The roster now shows exactly №, ФИО,
специальность, город, телефон, дата регистрации, присутствие; workplace,
region, email and the mail status move into the card. A row click (or Enter on
the focused row) opens the card in the right-hand side panel over the roster:
every stored field read-only, the registration source (сайт / стойка
регистрации / платформа), the consent (purpose, version, time, «на бумаге»),
the confirmation-mail outcome with its time, the «возможный дубль» marker, and
per congress day the attendance box (the same mark as the roster's) with the
history «кто — когда — отметил/снял». ↑/↓ in the panel walk the page's rows,
Esc closes it and returns focus to the row; the open card is in the address as
`?registration=<id>`, so a record can be linked. The desk's «Открыть запись»
for an already-registered email now opens that registration's card.
