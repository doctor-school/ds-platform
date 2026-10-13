---
"@ds/design-system": major
"@ds/auth-flow": major
"@ds/portal": patch
"@ds/doctor": patch
---

Auth screens on both storefronts (#2882, canvas `design-source/auth.dc.html`): the password fields — sign-in, registration and the reset «Новый пароль» — show no placeholder. Under the six code cells every code step states how long the code lives: «Код действует 1 час.» for the registration confirmation and the reset code, «Код действует 5 минут.» for sign-in by code; a mailed code adds «Не видите письмо — проверьте папку «Спам».». The line is the code field's description, so a screen reader reads it with the field. «Эл. почта» keeps its two words on one line (no-break space) in the channel switch and the SMS hint.

Breaking (`@ds/design-system`): `LoginCardCopy.password.passwordPlaceholder` and `RegisterCardCopy.passwordPlaceholder` are removed. New optional `OtpField.hint`, `OtpFocusScreen.codeHint`, `EmailConfirmCardCopy.codeHint`, `LoginCardCopy.otp.codeHint` (per channel) and `PasswordRecoveryCardCopy.complete.codeHint` (per held identifier).

Breaking (`@ds/auth-flow`): the copy keys `login.password.passwordPlaceholder` and `register.passwordPlaceholder` are removed; `login.otp.codeLifetimeHint`, `verify.codeLifetimeHint` and `reset.codeLifetimeHint` are new.
