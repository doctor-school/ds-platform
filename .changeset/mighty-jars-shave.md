---
"@ds/admin": patch
---

The admin event screen at `/events/<id>` stops clipping at phone widths. Its header kept the pre-#1387 single-row `justify-between`, so the event title block and the lifecycle state badge stayed side by side at every width and a realistic (long) title pushed the badge past a 390px viewport. The badge now stacks under the title below the `sm` breakpoint, matching the list surfaces. Desktop rendering is unchanged.
