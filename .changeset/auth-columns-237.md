---
"@ds/design-system": patch
"@ds/portal": patch
---

fix(237): brand panel left / form right — the recorded column-order decision. The `AuthLayout` split-screen shipped with the inherited shadcn `login-03` default (form-left / panel-right), but the #237 settled product-owner decision is brand-panel LEFT, form RIGHT. The form column stays first in source order (a11y — the interactive surface precedes the decorative panel) and is flipped visually on `lg+` via `lg:order-2` (panel `lg:order-1`); the `< lg` single-column layout (panel hidden, form fills) is unchanged.
