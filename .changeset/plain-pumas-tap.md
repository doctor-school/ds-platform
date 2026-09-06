---
"@ds/design-system": minor
---

003 EARS-38 — `<PasswordField>` gains a show-password toggle: a real keyboard-operable button inside the field (`aria-pressed`, `aria-controls`, localized accessible name, RU defaults overridable via the new `revealLabels` prop), masked by default, per-instance state that never persists across a page load, with the value and caret preserved across the swap. Adds an optional `placeholder` prop, and threads the toggle copy through `LoginCard` (`copy.password.reveal`) and `PasswordRecoveryCard` (`copy.complete.passwordReveal`).
