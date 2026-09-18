---
"@ds/storefront-shell": patch
"@ds/portal": patch
---

The Academy header reads the doctor's session on the server (#2281): the page
arrives with the right auth cluster already drawn — «Войти / Регистрация» for a
guest, «Мои события» and the profile chip for a signed-in doctor — instead of
painting the guest cluster first and swapping after a client fetch.
`apps/portal/lib/shell-auth.ts` resolves the shell's `auth` prop through
`@ds/auth-flow/server` (one session read, plus one self-profile read for the
initials chip); the client leaf `academy-shell-header-client.tsx` is gone.

`@ds/storefront-shell` drops the `refreshShellAuth` client signal and its
module: nothing needs it once the header is a server render. After login,
verify, reset and logout the flow navigates, which renders the header anew;
saving the profile name calls `router.refresh()` so the chip initials update
in place. `/`, `/documents` and `/documents/[slug]` become dynamic routes,
because their header now depends on the request's cookie.
