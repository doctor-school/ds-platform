---
"@ds/portal": patch
---

The Academy home shows the experts' new portrait photos (#2370). The six files
in `apps/portal/public/experts/` are replaced under the same names, and the
expert card anchors its 4:3 crop to the top of the portrait (`object-top`) so
the whole head stays in frame instead of the centre crop cutting off hair and
forehead.
