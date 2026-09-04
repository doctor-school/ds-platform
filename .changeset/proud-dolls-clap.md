---
"@ds/design-system": minor
---

014 EARS-8 — new `RecordingSpoiler` block (`@ds/design-system/recording-spoiler`): the «Смотреть оригинал трансляции» disclosure that carries an event's secondary recording cut under the main player. Native `<details>/<summary>` so keyboard operation and the expanded/collapsed a11y state come from the platform; the body is mounted only while open, so a provider frame inside it is never fetched for a collapsed spoiler.
