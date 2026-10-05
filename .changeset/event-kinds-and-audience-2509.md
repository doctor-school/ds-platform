---
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": major
"@ds/db": minor
"@ds/admin": minor
"@ds/doctor": minor
---

Each event now carries an audience and a kind from an editable dictionary
(012 EARS-25…30, #2509). The audience — doctors or market experts — alone
decides the storefront: doctors' events show only on the doctor storefront,
experts' events only on the Academy, in every public read. The kind (Вебинар,
Эфир, Конгресс, Встреча клуба, Мастер-класс, and any kind an editor adds in the
admin «Типы мероприятий» screen) allows a set of participation formats; the
admin event form offers only the formats the chosen kind allows, and narrowing
a kind while its events use a removed format is refused with those events
named. A project carries a default audience that prefills a new linked event.
Breaking API contract: creating an event requires `kindId` and `audience` (plus
a `participationFormat` the kind allows); creating a project requires
`defaultAudience`. The doctor storefront card shows the event's kind title.
Migration 0046 maps the existing events per the reviewed table and removes five
test events.
