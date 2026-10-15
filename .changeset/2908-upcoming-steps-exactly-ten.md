---
"@ds/schemas": major
"@ds/api": minor
"@ds/events-storefront": major
"@ds/portal": minor
"@ds/doctor": minor
---

«Будущие» steps add exactly 10 events on both storefronts (019 LD-2, #2908): «Показать ещё N (осталось M)» names what the step actually adds — 10, or every remaining event when 11 or fewer remain, so there is never a one-event tail — instead of growing the step to the 10th event's whole day. A day the 10th event shares with later ones continues on the next step. The «Будущие» extent is now `from` plus a `count` cursor that «Показать ещё» grows; a stated `to` stays a whole-day extent (a month-view day click on the extent's last day takes the whole day in). With 11 or fewer matching events the default screen shows them all.

**Breaking:**

- `@ds/schemas`: the doctor feed and the Academy horizon page replace `nextTo` with `nextCount` (the `count` «Показать ещё» writes into the URL); `DoctorEventsFeedQuerySchema`, `PublicEventListingQuerySchema` and the events-page codec gain `count` (`DoctorEventsFeedCountSchema`).
- `@ds/events-storefront`: `EventsFeedHorizon.nextTo` is replaced by `nextCount`.
