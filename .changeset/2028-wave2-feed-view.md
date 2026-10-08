---
"@ds/events-storefront": minor
"@ds/portal": minor
"@ds/doctor": minor
---

Events storefront wave 2 (#2028), PR 2.4: both storefronts render the one events feed view of `@ds/events-storefront` per the events-feed canvas — the head with the «Прошедшие | Будущие» tense tabs, «Идёт сейчас» (at most two strips, bounded refresh, its own error and retry), the signed-in reader's three nearest «Мои события», and the day feed whose «Показать ещё N из M» widens the horizon in the URL («Будущие» forward, «Прошедшие» back). Cards show the kind and the format, «Коллег записались: N» on upcoming and live cards, «N Pul» only when Pul is required, «НМО» / city / seats when present, and «Смотреть запись» on a past card only when a recording is published; online and hybrid times follow the viewer zone. A legacy Academy listing URL (`tab`, `cursor`, `cursorTrail`, `page`) permanently redirects to its canonical feed URL. The doctor feed's own composition, live block and resume scroll are removed; the guest account band and the card action leave the feed (a card is one link to its event page).
