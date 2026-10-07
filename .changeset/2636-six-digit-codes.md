---
"@ds/schemas": patch
"@ds/api": patch
"@ds/design-system": patch
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

Six-digit codes in every emailed/SMS code (#2636): the Zitadel generators converge to six digits, `VERIFY_CODE_PATTERN` is `^[0-9]{6}$` and the BFF refuses any other value before an IdP hop. Code cells (003 EARS-22/EARS-42, 021 EARS-11): `<OtpField charset="numeric">` takes the `design-source/auth.dc.html` code-cell attributes (`pattern="[0-9]*"`, `autocapitalize`/`autocorrect` off, no spellcheck) and keeps only the digits of every keystroke, paste and autofill — a letter never fills a cell; `<OtpFocusScreen>` and `<PasswordRecoveryCard>` take the numeric charset — the digit keypad and one-time-code autofill on every registration, sign-in and reset code step of both storefronts. `resolveVerificationCode` follows the six-digit `VERIFY_CODE_PATTERN`.
