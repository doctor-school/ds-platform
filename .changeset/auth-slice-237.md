---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(237): rebuild the portal auth surfaces on the design system — the reference vertical slice. login / register / verify / reset are re-skinned onto tokens + blocks from `@ds/design-system`, wrapped in the new `AuthLayout` split-screen block (shadcn `login-03`, re-skinned to tokens) with the Doctor School brand applied (primary blue `#2D84F2`, Inter, wordmark logo). Passwordless OTP login now renders the `OtpFocusScreen` block once a code is requested — masked destination + auto-submit + resend-with-cooldown + change-method — closing the #192/#196/#200/#211/#212/#227 papercut class. Masked destinations also applied to the verify/reset code steps. App glue (BFF `/v1/auth/*`, EARS-16 generic errors, i18n, auto-submit) is unchanged — only the presentation layer moved onto the system.
