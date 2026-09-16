---
"@ds/portal": patch
"@ds/doctor": patch
"@ds/storefront-shell": patch
---

Fit the giant footer wordmark to its box on both storefronts (#2234): the container-query coefficient each host carries is now derived from the measured glyph run of its own wordmark (`min(15.07cqw,240px)` for «Doctor.School», `min(8.76cqw,150px)` for «Academy.Doctor.School») instead of a hand-guessed one, so the run lands on the canvas's 96.5% of the footer box at every width. The old coefficients over-scaled the run by 2.4% (Doctor) and 5.7% (Academy) of the box — `overflow: hidden` clipped the tail of the word at EVERY viewport, which is what the owner hit on a 390px phone.
