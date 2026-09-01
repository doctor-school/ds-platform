---
"@ds/design-system": minor
---

Add `EventsFilter` (019 EARS-7) — the one shared events facet panel, exported from `@ds/design-system/blocks` and `@ds/design-system/events-filter`. It carries the full REQ-138 facet set (format, kind, specialty defaulting to «моя и смежные», city for offline events, «только с НМО», «бесплатно по Pul», name search), keeps every applied facet visible as a removable chip with a working reset and a stated applied count, and declares the three D-1 fill states (`wave-1` / `intermediate` / `full`) so a consumer mounting fewer facets breaks neither the panel nor the host grid. Presentational by contract: values in, the next `AppliedFacets` out — the URL/query codec stays a separate unit.
