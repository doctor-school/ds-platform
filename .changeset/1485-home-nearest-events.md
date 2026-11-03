---
"@ds/events-storefront": minor
"@ds/doctor": minor
---

The home nearest events (017 EARS-9, #1485) are the events page's own day feed block, capped: `@ds/events-storefront/feed` adds `EventsFeed`, which mounts `FeedSection` over the same upcoming feed read with a `limit` — the first N cards in the feed's own form, one «Все события» link to the listing in place of «Показать ещё», the feed's skeleton, empty and error renders, and the events page's block retry carrying the cap so a recovered block stays capped. The doctor home mounts it with `DOCTOR_HOME_FEED_LIMIT` (3) under «Ближайшие события».
