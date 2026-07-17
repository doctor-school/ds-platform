---
"@ds/design-system": patch
---

Month-calendar canvas-parity fixes (#1065, Stage-B rework at #1052): `cn()` registers the missing custom font sizes (`text-eyebrow`, `text-title-lg`) so tailwind-merge no longer strips them as colour conflicts — the #1052 off-scale defect; the month-grid pill is a single inline text run (block, wraps inside its cell — closes the 4-events/day overflow); a desktop day cell caps at 3 pills with a «+N ещё» overflow link slot; the legend row gains the next-month accent link slot; new `hero`/`hero-foreground`/`hero-muted` tokens (the discovery poster band, blue.500 light / blue.700 dark); the month-picker trigger spreads across a stretched mobile container.
