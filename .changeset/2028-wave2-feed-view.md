---
"@ds/events-storefront": major
"@ds/portal": major
"@ds/doctor": major
---

Events storefront wave 2 (#2028), PR 2.4: both storefronts render the one events feed view of `@ds/events-storefront` per the events-feed canvas — the head with the «Прошедшие | Будущие» tense tabs, «Идёт сейчас» (at most two strips, bounded refresh, its own error and retry), the signed-in reader's three nearest «Мои события», and the day feed whose «Показать ещё N из M» (N the events the next step adds, M all that remain) widens the horizon in the URL («Будущие» forward, «Прошедшие» back) on every URL, the bare `/webinars` and `/webinars?tense=past` included. Cards show the kind and the format, «Коллег записались: N» on upcoming and live cards, «N Pul» only when Pul is required, «НМО» / city / seats when present; a past card reads «Запись · <длительность>» with «Смотреть запись» when a recording is published and «Без записи» otherwise; online and hybrid times follow the viewer zone. A legacy Academy listing URL (`tab`, `cursor`, `cursorTrail`, `page`) permanently redirects to its canonical feed URL. The doctor feed's own composition, live block and resume scroll are removed; the guest account band and the card action leave the feed (a card is one link to its event page).

**Breaking (`@ds/events-storefront`):** `MAX_CURSOR_TRAIL`, `fetchEventListing`, `fetchEventListingWithCursorFallback`, `InvalidEventCursorError` and `EventListingInput` are removed (the feed reads the horizon, never a cursor trail); the `./adapters` page model requires `nextBatch`, and an Academy listing page without its horizon is refused as a failed read. **Breaking (`@ds/portal`, `@ds/doctor`):** the Academy `/webinars` cursor paging and the doctor feed's own composition are replaced by the shared feed view.
