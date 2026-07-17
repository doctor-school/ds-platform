---
"@ds/portal": patch
---

Month view Stage-B rework #2 (#1075, owner verdict #2 at #1052): a day cell's muted background now marks weekends and out-of-month filler ONLY — an empty weekday keeps the card surface (the date ink keeps the canvas past/weekend/empty rule); the legend's bottom-right month link is always-on and always targets the displayed month + 1 (year boundary included), no longer derived from per-month event counts.
