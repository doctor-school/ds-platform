---
"@ds/auth-flow": patch
"@ds/design-system": patch
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
this host's account page — or on the account or эфир page the visitor arrived
carrying; any other carried page, an эфир room included, lands on the account
page.

What a visitor can notice: the words now follow the owner's canvas on both
hosts — «Сброс пароля» / «Новый пароль», «Отправить код сброса», «Задать новый
пароль», «← Вернуться ко входу» and the conditional «Если для … есть аккаунт, мы
повторно отправили код.» (the doctor storefront used its own wording before);
the card shows the canvas key glyph; the doctor storefront's new-password field
gains the show-password toggle the Academy already had; and a reset that
started from an эфир on the doctor storefront now completes that registration
before landing, as sign-in does. The doctor storefront, which serves no SMS,
accepts an email address in the identifier box. The code field is unchanged.
A refused request, a refused code or password and a refused resend are now
said in the one error plate above the key glyph, as on the other sign-in
screens; asking for a new code withdraws a standing «Код не подошёл или пароль
отклонён.».
