---
"@ds/design-system": patch
---

`<DataTable>`: the mobile record card omits a field whose column `fullValue` is blank for that row, so a card never shows a label with nothing after it; the desktop grid keeps the empty cell. Columns without `fullValue` are unchanged.
