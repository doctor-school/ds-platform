---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

Auth tab titles on both storefronts (#2470): the Academy `/login`, `/verify` and `/reset` now name the screen in the browser tab («Вход — Doctor.School», «Подтверждение почты — Doctor.School», «Восстановление пароля — Doctor.School»), the same titles the doctor storefront shows. The four auth titles live once in `@ds/auth-flow/copy` (`AUTH_FLOW_PAGE_TITLES`) and both hosts project them.
