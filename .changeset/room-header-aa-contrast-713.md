---
"@ds/portal": patch
---

Room-header AA contrast (#713): the live presence count and the desktop exit-link label in the webinar-room header are now plain `text-header-foreground` (white) rendered directly on the `bg-header` band, matching the canvas layout with no plate. The AA fix is delivered by deepening the shared `header` band to blue.700 (white = 8.14:1, genuine WCAG-AA in both themes) — the earlier `primary-surface` plate treatment is reverted. The room-route axe e2e scan now includes the `.bg-header` band (no longer excluded).
