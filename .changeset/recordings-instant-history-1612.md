---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

014 EARS-22: the admin «Записи» tab lists recordings through the shared instant list — server-backed search, status and kind facets, removable chips, one «Сбросить всё» and a server pager. The recordings admin collection read gains the 012 list query (`page`/`pageSize`/`q`/`status`/`kind`/`includeRetired`, retired rows excluded by default) and returns an unfiltered `slots` projection beside the filtered page, so a filter can never empty the operator's two named slots. `AdminDataList` gains two optional props (`headingLevel`, `includeRetiredLabel`), both defaulted to today's behaviour.
