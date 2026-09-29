---
"@ds/events-storefront": patch
---

The storefront event page no longer turns into a server error for a signed-in
session whose role holds no doctor registration (#2232) — today a
`platform_admin`. The shared SSR registration read
(`fetchEventRegistrationState`) now treats the api's 403 `insufficient role`
like 401 and 404: there is no per-user state to compose, so it returns `null`
and the doctor `/events/<slug>` and Academy `/webinars/<slug>` pages render as
for a guest. A 5xx or network failure still throws. The api's roles are
unchanged: an administrator still cannot register for an event or hold a doctor
profile.
