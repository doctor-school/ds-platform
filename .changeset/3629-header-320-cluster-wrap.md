---
"@ds/storefront-shell": patch
---

The storefront header's right cluster (theme toggle, auth chip, `≡`) no longer pushes a 320 px phone sideways (#3629): below the `layout` breakpoint it may shrink to its row and wrap its tail, so the `≡` drops to its own right-aligned line when the guest cluster does not fit. From 360 px up nothing wraps and the bar is unchanged.
