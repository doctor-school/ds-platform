---
"@ds/design-system": minor
---

feat(272): global interaction-state base-reset in `globals.css` `@layer base` (ADR-0013 §7 layer 1). Restores `cursor: pointer` for enabled interactive elements (`button`, `[role="button"]`, `summary`, `label[for]`, `select`) and `cursor: not-allowed` for `:disabled` / `[aria-disabled="true"]` — fixing the Tailwind v4 Preflight regression that dropped the v3 `button { cursor: pointer }` reset — and adds a `@media (prefers-reduced-motion: reduce)` guard that neutralises transitions/animations platform-wide. One place; covers every current, future, and third-party element, so no component class needs to repeat it.
