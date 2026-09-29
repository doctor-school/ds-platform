---
"@ds/auth-flow": patch
"@ds/doctor": patch
---

A doctor who signs in on the doctor storefront now lands where a doctor who was
already signed in lands (#2333, 021 EARS-3 / LD-4): the specialty feed when a
specialty is remembered — including one kept on the PROFILE rather than in this
browser's guest cookie — and the front page otherwise.

The door's landing is decided at guest render, when no session exists and only
the guest cookie can be read. The shared sign-in, sign-up and confirmation
mounts now also hand their door a server action (`signedInLandingAction`,
`@ds/auth-flow/server`) that runs the SAME `resolveArrivalLanding` rule again on
the action's own request, which carries the new session cookie. The door awaits
it after password sign-in, after code sign-in and after the post-confirmation
sign-in, then completes the carried target over it exactly as before: a
validated `returnTo` still wins, and a failed call keeps the guest-time landing.
The action closes over the host's landing config (encrypted by Next), so the
browser passes no argument. The Academy's landing is a constant, so it gets no
action and behaves byte for byte as before.
