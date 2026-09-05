---
"@ds/design-system": patch
---

004 — the event hero keeps a phone viewport from scrolling sideways.
`EventPageHero`'s title column carries `min-w-0` so the status plate wraps
BELOW the title on a narrow screen instead of being pushed off the right edge.
The column could then be narrower than a single long Russian word
(«коморбидность», «инсулинотерапия»), whose overflow spilled past the hero and
gave the whole document a horizontal scroll (measured on the dev stand:
`in_archive` 5 px at 360 px, 45 px at 320 px; `ended` 11 px at 320 px).
`break-words` on the column — inherited by the kicker, the h1 and the date line
— breaks the word at the measure instead. The plate keeps its canvas geometry
(`flex-none`, `rotate-3`, top-right above the `layout` breakpoint) and no
lifecycle label is special-cased.
