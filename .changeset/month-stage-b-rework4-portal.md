---
"@ds/portal": patch
---

Month view Stage-B rework #4 (004, #1098): the «Неделя» and «Месяц» panes of
`/webinars` now share one static `CalendarShell` — a single navy hero + 1240px
content column — so switching views no longer jumps the header band or column
edges (owner verdict #3). The month toolbar's picker trigger, ‹ › pager and
«Сегодня» adopt the DS `Button` `outline` states; the view switcher's inactive
segment adopts the `Button` `ghost` states (owner verdicts #1/#2). The month picker
now pages years in place across a displayed-year ±1 window (owner verdict #4), and a
future month shows a «← <prev month>» return link (owner verdict #5). The `/`
front-door listing is unchanged.
