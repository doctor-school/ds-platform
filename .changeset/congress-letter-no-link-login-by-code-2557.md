---
"@ds/api": patch
"@ds/auth-flow": minor
---

The congress registration confirmation letter (site form and registrar desk)
carries no link, no button and no URL again — HTML and text parts (046 EARS-15).
The 046 submission letters keep their «Мои заявки на Конгресс» link.

`/login?method=code` opens the sign-in card on «По коду» on both storefronts
(003 EARS-43). `@ds/auth-flow/login/route` exports `LOGIN_METHOD_PARAM` and
`resolveLoginMethod` (closed allow-list: only `code` preselects the email-code
method; anything else keeps «Пароль»), and `LoginDoor` takes `defaultMethod`.
The tab bar stays and the carried `returnTo` is handled exactly as before.
