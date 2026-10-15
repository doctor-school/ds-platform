---
"@ds/design-system": minor
"@ds/admin": patch
---

`Button` gains `size="field"` — a button in one row with a text field takes the field control height (`h-11`, the same as `Input` / `NativeSelect` / `Combobox`) with the default horizontal padding, for every variant. The «Доступы» temporary-password row uses it, so «Скопировать» is no longer taller than the read-only password field.
