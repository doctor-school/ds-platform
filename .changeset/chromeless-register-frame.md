---
"@ds/doctor": patch
---

`/register` renders as a chromeless auth frame: no storefront header, navigation or footer, wordmark above the form column and the card centred on the vertical axis, per the `auth` canvas `#d-register` composition. The route moves into an `(auth)` route group and composes a doctor-local `AuthShell` over the design-system `AuthLayout` block.
