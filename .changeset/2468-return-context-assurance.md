---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

The event a visitor returns to beside `/login`, `/register` and `/verify` (both storefronts) now promises only the return — «После входа вы вернётесь сюда же.» / «После подтверждения почты вы вернётесь сюда же.» — with no seat promise (#2468), and the phone layout shows that line under the event card too, as the wide layout always did (#2465).
