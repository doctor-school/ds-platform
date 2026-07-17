---
"@ds/design-system": major
"@ds/portal": patch
---

fix: the alphanumeric registration / password-reset verification code no longer traps mobile users on a digits-only keyboard (#1110). `OtpField` (and `OtpFocusScreen`, which forwards it) gain a **required** `charset: "alphanumeric" | "numeric"` prop: the slotted variant now requests `inputMode="text"` + `autoCapitalize="characters"` for alphanumeric codes so a phone shows the full keyboard, and `inputMode="numeric"` for the digit login OTP. `/verify` and `/reset` pass `charset="alphanumeric"`; `/login` passes `charset="numeric"`.

BREAKING (`@ds/design-system`): `charset` is a required prop on `OtpField` and `OtpFocusScreen` — every slotted call site must declare its code's character set (no silent default, so no surface can inherit the wrong mobile keypad).
