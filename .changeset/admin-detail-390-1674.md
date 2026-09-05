---
"@ds/admin": patch
"@ds/design-system": patch
---

Admin expert / project / partner detail screens fit a 390px phone viewport: the heading and the status badge stack below `sm` (the #1387/#1399 pattern) and the heading wraps instead of widening its flex line. The `FormDerivedNote` block breaks its derived value, so a long public link no longer pushes the page fold on a phone.
