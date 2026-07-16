---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(portal): 004 EARS-19 — month-calendar view at `/webinars?view=month` (desktop 7-column grid, mobile dot-grid + selected-day agenda). Adds the display-only `MonthCalendarGrid`, `MonthDotGrid`, and `DayAgenda` presentation blocks to `@ds/design-system` (token-only, catalogued in the showcase), and wires the portal pane: current-МСК-month projection read, live pill/dot from `EventLifecycleState`, muted past-day notes, today outline, state legend, and the «Неделя / Месяц» switcher (#1050).
