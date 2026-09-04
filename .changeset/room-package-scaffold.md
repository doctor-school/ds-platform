---
"@ds/room": minor
"@ds/portal": patch
---

Extract the webinar room's pure model and browser transport into the shared `@ds/room` package. The portal keeps its room components and re-export shims, so there is no behaviour or render change; only import paths move.
