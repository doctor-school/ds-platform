---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One password-recovery flow on both storefronts (#2027, epic #2020 wave 1).
`@ds/auth-flow/reset` owns both stages of «Сброс пароля» — the identifier step
behind the invisible challenge, the code and new-password step with its reveal
toggle, the resend with its neutral notice, «Начать заново» and the way back to
sign-in — and both hosts mount it from their `/reset` route through
`@ds/auth-flow/reset/route`. A signed-in doctor can still open `/reset` (the
cabinet «Сменить пароль» entry), and a completed reset still lands signed in on
the carried page, or on the account page when the visitor arrived carrying
nothing.

What a visitor can notice: the words now follow the owner's canvas on both
hosts — «Сброс пароля» / «Новый пароль», «Отправить код сброса», «Задать новый
пароль», «← Вернуться ко входу» and the conditional «Если для … есть аккаунт, мы
повторно отправили код.» (the doctor storefront used its own wording before);
the card shows the canvas key glyph; the doctor storefront's new-password field
gains the show-password toggle the Academy already had; and a reset that
started from an эфир on the doctor storefront now completes that registration
before landing, as sign-in does. The doctor storefront, which serves no SMS,
accepts an email address in the identifier box. The code field is unchanged.
