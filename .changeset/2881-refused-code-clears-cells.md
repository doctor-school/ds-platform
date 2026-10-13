---
"@ds/design-system": patch
---

The code step sends a typed code once (#2881): when the host refuses it, `<OtpField>` (via the new `rejection` prop, threaded through `<OtpFocusScreen>`, `<EmailConfirmCard>`, `<LoginCard>` and `<PasswordRecoveryCard>`) empties every cell and returns the caret to the first, so the confirm button or Enter can no longer re-send the refused code. The refusal plate stays; the reset step keeps the new password.

A code step now opens with the caret in its first cell (#2881): `<OtpField autoFocus>` (threaded through `<OtpFocusScreen>`) places it when the field mounts, never on a re-render. `<EmailConfirmCard>`, `<LoginCard>` and `<PasswordRecoveryCard>` set it on their code step; the new `autoFocusCode` prop (default `true`) lets a catalog specimen opt out.
