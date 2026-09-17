---
"@ds/design-system": patch
---

#2027 — every auth form in the package submits by POST. `<LoginCard>`,
`<PasswordRecoveryCard>`, `<RegisterCard>`, `<EmailConfirmCard>` and
`<OtpFocusScreen>` render their `<form>` with `method="post"`, so a visitor who
presses the button before the bundle hydrates submits natively into the request
BODY instead of GET-ing their password, identifier or one-time code into the
URL, the browser history and every access log on the way. `action` stays off:
the HTML default is the current document URL, which is the path the native
submit should use, and a path prop would put a host route inside the design
system. No visual delta — the rendered surface is unchanged.
