---
"@ds/event-page": patch
---

014 EARS-7 (#4180): the recording player no longer replaces a working RuTube player (and any provider player that reports its readiness to the page) with «Запись временно недоступна» when a third-party script inside the provider's frame is slow — the provider's own ready signal from the mounted frame now counts as delivery, alongside the frame's `load`.
