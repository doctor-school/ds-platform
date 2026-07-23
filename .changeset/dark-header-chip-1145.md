---
"@ds/portal": patch
"@ds/design-system": minor
---

fix(header): dark-theme-safe profile chip + shared header user cluster

- The white on-header chips (avatar / «Войти» / mobile ≡) now cast the
  theme-invariant `shadow-header-chip` tone (neutral.900 in both themes) instead
  of `shadow-btn` (whose `border` cast flips to white in dark). In dark theme the
  profile chip is no longer a white square with a white shadow on the navy band
  (#1145); light theme is pixel-identical.
- The webinar-room header and the app-shell header now render one shared
  `HeaderUserCluster` (theme toggle + profile chip, toggle left / chip rightmost),
  so the room follows the shell's order and the chip presentation is a single
  source of truth (#1146).
