---
"@ds/portal": patch
---

Month view Stage-B rework #3 (#1080, owner verdict #3 at #1052): the calendar surfaces (month grid, week listing, hero inner bands) span the full canvas 1240px content column at desktop, and the app-shell header renders the canvas light-theme blue `#2D84F2` — one continuous band with the hero poster (both via `@ds/design-system` tokens, no component change); the month-fidelity e2e pins the 1240px grid content width, the header/hero colour seam in both themes, and the live pill's 700 text weight.
