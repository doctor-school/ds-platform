---
"@ds/design-system": patch
---

The code step sends a typed code once (#2881): when the host refuses it, `<OtpField>` (via the new `rejection` prop, threaded through `<OtpFocusScreen>`, `<EmailConfirmCard>`, `<LoginCard>` and `<PasswordRecoveryCard>`) empties every cell and returns the caret to the first, so the confirm button or Enter can no longer re-send the refused code. The refusal plate stays; the reset step keeps the new password.
