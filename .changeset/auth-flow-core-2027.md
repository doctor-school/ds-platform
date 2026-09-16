---
"@ds/auth-flow": minor
"@ds/portal": patch
"@ds/doctor": patch
---

One auth core for both storefronts (#2027, epic #2020 wave 1). The auth client,
the error dictionary, the bot-protection composition and the field rules move
out of `apps/portal/lib` and `apps/doctor/lib` into the new private package
`@ds/auth-flow`, which each host mounts through a value file
(`lib/auth-flow-config.ts`): the paths, the OTP channels, the captcha site key
and every sentence a doctor reads stay the host's, the rules are the package's.

One user-visible delta rides along, and it is the point of gate row 13 (#2001):
on the doctor storefront a 429 from the confirmation step now renders
«Слишком много попыток. Подождите пару минут и попробуйте снова.» instead of
«Код не подошёл. Попробуйте ещё раз.» — the confirm-step `catch` routes through
the same dictionary as every other auth failure, so the status decides the
sentence. The Academy keeps its own wording and behaviour; its captcha token
now travels in the `x-smartcaptcha-token` header instead of the request body
(the api has always accepted both), which is the one transport contract the
package owns.
