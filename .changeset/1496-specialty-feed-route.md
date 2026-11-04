---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
"@ds/events-storefront": minor
"@ds/doctor": minor
---

The specialty feed (018 EARS-1, EARS-4, #1496 / #1499): `GET /v1/storefront/feed/{specialty}` answers the `SpecialtyFeed` envelope (the specialty, the connected blocks in the F-018-1 order — release 1: events only — `order: "events-first"`, `viewer.loggedIn`; an unknown specialty is `SPECIALTY_FEED_NOT_FOUND`, 404) and `GET /v1/storefront/feed/{specialty}/events` the nearest three events of the specialty from 019's doctor events feed service. `@ds/events-storefront/feed` adds `SpecialtyEventsBlock`, which renders that read through the events feed's card list with the feed's own error copy, empty state and block retry. The doctor host serves `/feed/<specialty>` inside 017's shell: breadcrumbs, the specialty heading with «сменить специальность» re-opening the specialty catalog, then the nearest-events block with «Все события по специальности →» into the events feed for the specialty.
