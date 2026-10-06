---
"@ds/design-system": patch
"@ds/doctor": patch
"@ds/db": patch
---

`WebinarCard` renders the sign-up chip label first and the count after a colon («Коллег записались: 128»), so the wording needs no Russian plural agreement (#2617); the doctor feed passes the capitalised label. The golden seed no longer lists «Терапия» twice on an эфир whose own specialty is already «Терапия», which rendered the chip twice on the Academy listing (#2618).
