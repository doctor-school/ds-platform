---
"@ds/events-storefront": minor
"@ds/doctor": minor
---

The home nearest-events block (017 EARS-9, #1485): `@ds/events-storefront/home` adds `HomeEvents` — a short preview of the upcoming events feed (the same feed read with the relayed specialty cookie, the same card unit, the first `cardCap` cards, «Все события →») with card skeletons, the host's empty copy and «Не удалось загрузить события.» + «Обновить», whose retry re-runs that one read. Hosts state `HomeEventsHostConfig` values only; the doctor home mounts it with three cards, the Academy home will in #1799.
