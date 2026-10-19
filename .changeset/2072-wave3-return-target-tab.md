---
"@ds/schemas": minor
---

The return-target guards keep the hybrid event page's active tab (020 LD-9 / EARS-5, #2072): `parseSameOriginReturnTarget` keeps a closed `mode=offline|online` next to the land-only marker (canonical order `mode=…&intent=land`; any other query is still dropped whole), the academy and doctor event-page shapes admit `?mode=offline|online` and rebuild it, and the land-only parser accepts the marker after a tab. A doctor who registers from the «Онлайн» tab lands back on it. New exports: `RETURN_TARGET_MODES`, `ReturnTargetMode`, `canonicalReturnTargetQuery`.
