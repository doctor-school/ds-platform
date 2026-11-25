---
"@ds/learning": patch
"@ds/schemas": patch
"@ds/room": patch
"@ds/event-page": patch
---

024 EARS-10: a video step completes at the media's own end. The step reports the media length and «ended» its provider's player sends (youtube `infoDelivery` duration / playerState 0, rutube `player:durationChange` / `player:playComplete`, vk event `duration` / `ended`); the server watches the step to that length — never longer than the typed length, never under half of it — while every position stays clamped by the server clock. cdnvideo reports nothing and keeps the typed length.
