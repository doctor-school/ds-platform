---
"@ds/design-system": minor
---

Emit a `.light` forced-light theme reset alongside `.dark`. `:root` declares the light theme document-wide but cannot reset a subtree nested inside a `.dark` ancestor (CSS custom properties inherit), so a region that must stay light under a dark page had no affordance. The token build now also writes the light semantic colour roles under an explicit `.light` class — the mirror of `.dark` — so any subtree can pin light regardless of an ancestor theme. Additive (no token values change); enables the showcase's runtime page-level theme toggle to keep its light/dark specimen pairs side-by-side, and gives product apps a forced-light island (e.g. a print preview) for free.
