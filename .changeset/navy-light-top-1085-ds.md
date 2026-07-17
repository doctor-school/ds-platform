---
"@ds/design-system": patch
---

Navy light-theme top (#1085, owner verdict #4 at #1052): the light `header` and `hero` semantic tokens repoint from the canvas bright blue.500 (#2D84F2) to production navy blue.700 (#114D9E), so the light top now equals the dark top and prod — one continuous navy band (dark set unchanged). White on blue.700 = 8.14:1, full normal-text AA in both themes, retiring the #1083 large-text-nav carve-out route (rejected by the owner). `header-chip-foreground` is value-unchanged; token `$description`s that named the light header/hero as bright blue are rewritten inline. The vendored `design-source/*.dc.html` canvases still render #2D84F2 light — the recorded owner-directed deviation pending the DesignSync follow-up.
