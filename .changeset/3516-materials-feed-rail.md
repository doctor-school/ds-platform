---
"@ds/design-system": minor
"@ds/portal": minor
---

048 EARS-13/14/15/16/19 (#3516): `@ds/design-system/blocks` adds `FeedCard` / `FeedCardSkeleton` (the shared content card) and `FeedRail` (the section «Новости, блог и видео» over a host-passed `loadPage`). The Academy home shows the rail right after the events block: it reads `GET /v1/public/feed` in the browser on every visit, shows placeholders while the first page loads, an honest empty state, an error with «Повторить», and loads older materials near the end of the rail.
