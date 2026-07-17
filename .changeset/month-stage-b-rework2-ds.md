---
"@ds/design-system": patch
---

Month-calendar grid Stage-B rework #2 (#1075, owner verdict #2 at #1052): a dedicated `calendar-muted` token (canvas-exact `oklch(0.985 0.002 250)` light / `oklch(0.185 0.02 250)` dark) replaces the shared `section` token on the month-grid day cell and the legend «Прошёл / пусто» swatch (the week-listing day band keeps `section`); every event pill's text run clamps at two lines via an inner `line-clamp-2` span (canvas `clamp2` — live pills included, the «+N ещё» link and past-day notes untouched); the `muted` cell prop and the `nextMonthLink` prop docs now state the owner rules (muted bg = weekend/out-of-month only; the link is always the displayed month + 1).
