---
"@ds/design-system": minor
---

`EventsFilter` renders the storefront's own facet set from `host` (doctor: name search, specialty «Моя и смежные» / «Все специальности» + combobox, format, kind, city, direction, «Только с НМО»; Academy: project, expert, topic) per the approved `events-facets.dc.html`; picked combobox values are removable chips, the header states «Фильтры», the applied count and «Сбросить» only while something is applied, and `showHeader={false}` yields the mobile sheet body. Replaces the `fill` / `view` / `tense` / `freeByPul` API; adds `countAppliedFacets` and `defaultAppliedFacets`.
