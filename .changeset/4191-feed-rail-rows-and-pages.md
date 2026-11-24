---
"@ds/design-system": patch
"@ds/portal": patch
---

`FeedRail` (048, #4191): on a desktop the cards take one row in feed order and two rows only when even the two-row grid overflows the rail, so a few cards no longer leave half the section empty. ← / → move one page of whole visible columns in equal steps, and the last page stops with the last column at the right gutter.
