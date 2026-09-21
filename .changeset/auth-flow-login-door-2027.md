---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One sign-in door on both storefronts (#2027, epic #2020 wave 1). `@ds/auth-flow/login`
owns the `/login` screen — the identifier and password fields, the method switch, the
return-context card and the post-sign-in landing — and both hosts mount it from their
own route file plus host config. The Academy door is now rendered by the package rather
than by `apps/portal/app/login/page.tsx`, with no change a signed-in user can see.

On the doctor storefront the door gains what only the Academy had: the submit button
reports its in-flight state (`aria-busy`) instead of going quiet, the SmartCaptcha
challenge is rendered where the api asks for a token, and the «passing the automated
check» processing notice appears while that token is minted. The same notice now also
shows on the doctor `/register` and `/reset` screens, which sit inside the shared
`AuthShell` frame this PR moves into the package. Copy, field order and the steps
themselves are unchanged on both storefronts.
