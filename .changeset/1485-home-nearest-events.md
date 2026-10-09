---
"@ds/events-storefront": minor
"@ds/doctor": minor
---

The doctor home page shows the nearest events (017 EARS-9, #1485): `@ds/events-storefront` gains `./home` (`HomeNearestEvents`) — «Ближайшие события» with «Все события →», the nearest events as the feed card beside the compact month, general before a specialty is chosen and targeted after, with card skeletons, an honest empty statement (the adjacent-areas link only when the specialty reaches adjacent areas) and «Не удалось загрузить события.» with a working «Обновить». The feed page model carries the read's `targeting`; `BlockError` takes an optional `retryLabel` and description. A specialty chosen in the home catalog re-targets the block without a reload.
