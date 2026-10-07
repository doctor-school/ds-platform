---
"@ds/api": minor
"@ds/schemas": minor
"@ds/auth-flow": minor
---

The Congress «Войти в кабинет» sign-in link now works in a browser that is already signed in (#2659). Signed in as the link's own account, `/login` goes straight to the carried target with no code (the hand-off answers `already_signed_in`, sends nothing and counts no redemption); signed in as another account, the code goes to the link's account and the code sign-in revokes the prior session, so the browser ends with the link account's session only.
