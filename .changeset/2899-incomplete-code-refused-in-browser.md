---
"@ds/design-system": patch
"@ds/auth-flow": patch
---

`OtpCodeFieldSchema` is the six-digit `code` FieldSpec rule, so the sign-in and password-reset code steps refuse an incomplete code in the browser with «Введите код.», keep the typed digits and send no request (003 EARS-22, #2899).
