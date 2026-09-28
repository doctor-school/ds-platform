---
"@ds/design-system": minor
---

New `Sheet` primitive — a side panel for record inspectors (#2396), adopted from
official shadcn/ui `sheet` (MIT) on the Radix Dialog substrate and re-skinned to
the DS tokens. `SheetContent` docks right (or left) at a third (`md`) or half
(`lg`) of the viewport; from the `lg` breakpoint it is non-modal so the list
behind stays visible, scrollable and clickable, and below `lg` it becomes a modal
full cover with a focus trap. Esc and × close it; `onNavigate` pages to the
previous/next record on ↑/↓ unless focus is in a form field. `SheetBody` is the
only scrolling region and `SheetFooter` holds the actions, so one panel hosts
both a read card and an entry form.
