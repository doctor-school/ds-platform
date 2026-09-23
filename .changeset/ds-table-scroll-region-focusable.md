---
"@ds/design-system": patch
---

`Table`: the horizontal scroll wrapper becomes a keyboard-focusable named region (`role="region"`, `tabIndex=0`, `aria-label` from the new `regionLabel` prop, default «Таблица») only while the table overflows, with a token focus ring. `DataTable` lays the grid out with `table-fixed` so its declared column widths and truncation finally apply, and names the region with its caption.
