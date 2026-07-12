---
"@ds/design-system": minor
---

Header band deepened to blue.700 for WCAG-AA (#713): the `header` semantic token now resolves to blue.700 (`#114d9e`) instead of blue.500 (`#2d84f2`). White `header-foreground` on the band goes from 3.69:1 (which met only the large/bold ≥3:1 carve-out) to 8.14:1, clearing AA for normal-weight body text as well. blue.700 is already the dark-theme header value, so the header band is now identical in both themes. This is a global token change — it affects every brand-chrome header band across all apps.
