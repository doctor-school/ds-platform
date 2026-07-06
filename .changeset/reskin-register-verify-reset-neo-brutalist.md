---
"@ds/portal": minor
---

Re-skin the `/register`, `/verify` and `/reset` surfaces to the neo-brutalist
language (#519). Each screen now composes the already-re-skinned design-system blocks
(`AuthCard`, `AuthLayout`, `OtpFocusScreen`, `Alert`, `Button` — #512/#513/#517) into
the canvas `auth.dc.html` composition, matching the merged `/login` re-skin (#518):

- register: canvas title/description/consent copy.
- verify: the two co-equal sections gain the canvas eyebrow caps-labels; the accepted
  code shows a «Код принят — входим…» success row (the DS `Alert` success variant)
  while the auto-login replay routes; «Войти» reads as the primary action.
- reset: the card title tracks the stage («Сброс пароля» → «Новый пароль»), canvas
  code/label copy, and the «← Вернуться ко входу» back link.

Purely visual — no form logic, BFF call, resend cooldown, OTP length (verify/reset
still 6), or consent semantics changed.
