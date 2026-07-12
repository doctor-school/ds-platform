---
"@ds/portal": patch
---

Room-header AA contrast (#713): the live presence count and the desktop exit-link label in the webinar-room header now sit on a `primary-surface` (blue.700) plate with `primary-surface-foreground` (8.14:1, genuine WCAG-AA in both themes), replacing the white-on-`bg-header` treatment that measured only 3.69:1 at 14px bold. The room-route axe e2e scan no longer excludes the `.bg-header` band.
