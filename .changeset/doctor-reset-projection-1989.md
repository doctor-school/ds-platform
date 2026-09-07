---
"@ds/doctor": patch
---

017 — the doctor host owns password recovery. `/reset` is a host route that
projects the shared `PasswordRecoveryCard` (request → code → new password →
auto-login → `/account`), so «Забыли пароль» on `/login` and «Сменить пароль»
on `/account` no longer send the doctor to the Academy: both links stay on the
storefront.
