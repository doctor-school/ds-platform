---
"@ds/design-system": minor
---

Month view Stage-B rework #4 (004, #1098): `MonthPicker` now pages years IN PLACE
(owner verdict #4) — a client `<details>` that steps a server-provided year window
without navigation (popover stays open, per-month counters swap), falling back to a
server-navigation `<a>` at the window edge; the props move from `year`/`months` to
`initialYear`/`years` (`MonthPickerYear[]`, new exported type). The trigger + year
‹ › steppers adopt the `Button` `outline` states so the trigger reads as a white
bordered control on the navy hero, not the old filled-blue summary (owner verdicts
#1/#2). `MonthCalendarGrid` gains an optional `prevMonthLink` — the «← <prev month>»
return link rendered left of the always-on next-month link (owner verdict #5).
