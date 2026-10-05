---
"@ds/design-system": major
"@ds/auth-flow": major
"@ds/portal": patch
"@ds/doctor": patch
"@ds/admin": patch
"@ds/showcase": patch
---

One code step (003 EARS-42/41): sign-in by code and the post-registration confirmation draw the same step on both storefronts — «Проверьте почту» / «Проверьте телефон», the masked address, six letter-or-digit cells, «Подтвердить и войти», «← Изменить способ» / «← Изменить почту» beside the resend cooldown, and «Мы отправили новый код на …» after a resend; the sign-in method tabs are hidden on that step.

Breaking (`@ds/design-system`): the 8-digit login code is gone — `LOGIN_OTP_LENGTH`, `EMAIL_CONFIRM_OTP_LENGTH` and every `otpLength` prop of `LoginCard` / `EmailConfirmCard` are removed (`CODE_STEP_LENGTH` = 6); `OtpFocusScreen` takes `backLabel` / `onBack` and no longer renders a title, a sent-to line, a length, a variant or a charset; `OtpField` drops the `plain` variant and its `variant` / `placeholder` props; `LoginCardCopy.otp.verifyTitle` / `codeLabel` are per channel and `resentTo` is new; `EmailConfirmCard` loses the co-equal sign-in / reset links (`links`, `renderLink`, the existing-account copy) and requires `onBack` and `resend`; `takePendingRegistration` is replaced by `peekPendingRegistration` over a `{ identifier, registration, form }` hold.

Breaking (`@ds/auth-flow`): the host config names its verify command in `api.verifyPath`; the code step submits the held registration values with the code to it and the accepted answer is the session — the post-verify password replay and the cold-step routing to `/login` are gone. A 021 access-condition refusal on the doctor verify reads as the registration door reads that condition.
