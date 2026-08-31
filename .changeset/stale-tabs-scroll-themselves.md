---
"@ds/design-system": patch
---

Tabs: the segment strip scrolls itself instead of the page when its segments no longer fit. A five-segment RU tab bar has a min-content width `flex-1` cannot shrink past, so on a phone-width admin detail screen that width landed on the document and the page side-scrolled by 149px at 390px. At every width where the segments already fit the render is unchanged. Because a scroll container clips outer box-shadows on its children, the segment's keyboard-focus ring is now the inset `shadow-focus-inset` token — same 3px blue.300 @ 50%, drawn inside the segment edge, fully visible at every width and scroll offset.
