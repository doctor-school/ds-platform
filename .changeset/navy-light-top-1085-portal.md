---
"@ds/portal": patch
---

Navy light-theme top (#1085, owner verdict #4 at #1052): the desktop app-shell nav links revert from the #1083 large-text tier (`text-xl`) to their pre-#1083 size — `font-bold` (700) inheriting the nav container's `text-sm` (14px). On the now-navy blue.700 header band the inactive `opacity-80` tier composites to ≥6:1 (the historical AA-clean state), so the reds the #1083 flip introduced on the resting nav tier and the theme-toggle glyph dissolve. No behavioural change beyond size/weight; press-state re-anchoring (#1007) untouched.
