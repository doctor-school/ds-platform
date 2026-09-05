---
"@ds/design-system": patch
---

Combobox: key cmdk items by the option `value` instead of the label, carrying the label as a search keyword. Two options sharing a label (two experts with the same printed name) no longer highlight together on hover or keyboard, and selecting one commits its own value. Fixes the Stage-B defect reported on #1607 in the «Привязать эксперта к мероприятию» dialog.
