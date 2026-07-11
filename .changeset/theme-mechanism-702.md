---
"@ds/portal": minor
---

Portal-wide light/dark theming (006 EARS-12/13, #702): the theme is the `.dark` class on `<html>` resolved from the `ds-theme` localStorage choice → else **dark**, the product default (an explicit choice always wins; the system `prefers-color-scheme` is never consulted), applied before first paint by an inline FOUC-guard script in the root layout; the webinar-room header gains the portal's only visible theme toggle — the canvas 44×44 icon-button (`aria-pressed`, glyph ☾ light / ☀ dark, `header-hairline` border) — which flips the theme live and persists the choice; the portal axe e2e suites now sweep both themes.
