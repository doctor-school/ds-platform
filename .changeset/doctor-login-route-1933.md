---
"@ds/doctor": minor
---

Doctor storefront `/login`: the shell's guest «Войти» action now resolves to a real
route instead of a 404. The route projects the shared `@ds/design-system/blocks`
`<LoginCard>` inside the doctor `(auth)` chromeless frame — password and one-time-code
sign-in, RU copy, the validated `returnTo` carried onward into `/register`, and a
server-decided post-login landing.
