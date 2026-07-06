---
"@ds/portal": minor
---

Re-skin the `/login` surface to the neo-brutalist language (#518). The screen now
composes the already-re-skinned design-system blocks (`AuthCard`, `AuthLayout`,
`OtpFocusScreen`, `Tabs`, `Button` — #512/#517) into the canvas `auth.dc.html`
composition: the brand panel gains an eyebrow caps-label above a heavier headline +
sub-copy (the shared `AuthShell` aside, mirrored by the showcase `NeutralAside`), the
password ⇄ one-time-code segment control and the «Эл. почта | SMS» channel selector
read in the canvas language and split the row into equal halves. Purely visual — no
form logic, BFF call, resend cooldown, OTP length (still 8), or behaviour changed.
