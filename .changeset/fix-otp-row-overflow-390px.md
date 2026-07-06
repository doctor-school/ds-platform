---
"@ds/design-system": patch
---

Fix the OTP slot row overflowing a narrow card body (#544). The `InputOTPGroup` is now
`w-full` and each `InputOTPSlot` is a `flex-1 aspect-square` cell capped at the canvas
40px (`max-w-10`): the 8-slot login row shrinks to fit at 390px instead of overflowing
the page body by ~30px, while wider cards and the 6-slot verify/reset rows keep the
unchanged 40px square cell. Both themes; neo-brutalist shared-border look preserved.
