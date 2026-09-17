---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

#2027 — the auth flow reads the same on both storefronts. Four rules are written
down in the `@ds/auth-flow` README (S1 a guest on a closed page is turned around
on the server, before any paint, carrying their own page; S2 a signed-in visitor
is bounced off the auth forms the same way; S3 every hop between the entry
screens carries the return target forward through the shared helper, never a
bare route literal; S4 every landing honours the carried target through the
host's one landing rule), and every deviation from them is fixed here.

On doctor.school the confirmation screen's «Войти», the login screen's «Забыли
пароль», the reset screen's «Войти», the cabinet's password link and the
`/register` landing now all carry the target; on the Academy the same is true of
the `/login` and `/verify` recovery links and of `/reset`, whose «Войти» link
and post-completion landing learn about the carried target for the first time.
A doctor who arrives at a closed page and wanders between entry, registration,
confirmation and recovery comes back to the page they opened, whichever screen
they finished on.
