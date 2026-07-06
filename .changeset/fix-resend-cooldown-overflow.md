---
"@ds/portal": patch
"@ds/design-system": patch
---

Fix the resend-cooldown row overflowing the auth card frame (#542). The `Button` base carries `whitespace-nowrap`, so the longer verify/reset resend copy («Отправить повторно можно через N с») could neither wrap nor shrink in the `justify-between` row and pushed past the card's right border (owner-reported on /reset). Two changes: (1) the verify + reset resend copy now matches the canvas canonical form the login OTP screen already uses — «Отправить снова» / «Отправить снова · N с»; (2) the resend control on the shared `<OtpFocusScreen>` block and the inline reset/verify rows gains `min-w-0 whitespace-normal text-right` (with `shrink-0` on the neighbouring change-method / start-over control) so the cooldown label wraps instead of overflowing at any width, both themes. Cooldown timing/logic unchanged.
