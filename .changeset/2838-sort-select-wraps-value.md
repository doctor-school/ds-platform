---
"@ds/design-system": minor
"@ds/admin": patch
---

`NativeSelect` gains an opt-in `wrapValue` prop that shows the chosen option in full on a wrapping line (the real select stays native, laid transparently over it); `DataTable`'s below-`md` «Сортировка» select uses it, so the admin congress roster's sort value is no longer cut to «…» at 390 px (#2838).
