---
"@ds/portal": patch
---

Webinar room: always-present truthful direct-watch link beneath the player (#1125). A well-formed embed can render a silent black iframe the app cannot detect cross-origin — YouTube geo-blocked in RU, or «Allow embedding» left off on the broadcast. The room now resolves the provider-correct direct watch URL (`youtube.com/watch?v=` / `rutube.ru/video/<id>/`) and surfaces it as an honest escape hatch whenever there is a stream, so a doctor is never left staring at a black screen with no way out.
