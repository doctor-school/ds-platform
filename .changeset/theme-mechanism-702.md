---
"@ds/portal": minor
---

Portal-wide light/dark theming (006 EARS-12/13, #702): the theme is the `.dark` class on `<html>` resolved from the `ds-theme` localStorage choice → system `prefers-color-scheme` (explicit choice wins, followed live while unset), applied before first paint by an inline FOUC-guard script in the root layout; the webinar-room header gains the portal's only visible theme toggle (DS `switch` primitive) which flips the theme live and persists the choice; the portal axe e2e suites now sweep both themes.
