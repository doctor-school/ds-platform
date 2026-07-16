---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(portal): 004 EARS-17/18 — month navigation (‹ › paging + 12-month picker) and the «Неделя / Месяц» view switcher on `/webinars?view=month`. Adds the display-only `MonthPicker` presentation block to `@ds/design-system` (native `<details>` disclosure, year ‹ › stepper, per-month event counts, past months muted «прошёл»; token-only, catalogued in the showcase) and wires the portal month toolbar: server-component query-param paging (validated `month`, absent/malformed → current МСК month), the `MonthlyEventCount` picker feed, a «Сегодня» reset, and the shared `ViewSwitcher` that carries the displayed month so the week↔month round-trip is loss-free (#1051).
