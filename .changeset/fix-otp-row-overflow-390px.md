---
"@ds/design-system": patch
---

Fix the OTP slot row overflowing a narrow card body (#544). `InputOTPGroup` and each
`InputOTPSlot` now carry `min-w-0`, and the slot is an `aspect-square` cell with a
preferred `w-10` width (the approved #512 deviation from the canvas 42×52 wrapped
inputs): the 8-slot login row shrinks to fit at 390px instead of overflowing the page
body by ~30px, while wide layouts — including 6-slot verify/reset rows and multi-group
compositions with a separator — keep the unchanged 40px square cell and their existing
geometry. Both themes; neo-brutalist contiguous shared-border look preserved.
