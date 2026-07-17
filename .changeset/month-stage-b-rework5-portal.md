---
"@ds/portal": patch
---

Month view Stage-B rework #5 (004, #1102, owner verdict #6): three fixes. (1) The
month toolbar's four controls (picker trigger, ‹, ›, «Сегодня») now render one equal
height. (2) The «Неделя» pane's list body gains desktop top clearance so its first
day-group heading no longer rides up onto the navy hero band — a regression from
#1098's shared-`CalendarShell` unification; the shell geometry (hero/column/switcher)
is unchanged. (3) The picker year ‹ › stepper now pages in place for ≥3 consecutive
steps in either direction before any edge (window widened to displayed year ±3), and
the edge-fallback navigation re-centres on the year just BEYOND the edge so the step
always advances instead of re-centring on the year already displayed.
