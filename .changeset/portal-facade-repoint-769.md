---
"@ds/portal": minor
---

Facade re-point (#769): the portal front door `/` now forwards to the real public
upcoming-broadcasts listing (`/webinars`) instead of the 003-era «Каркас приложения»
scaffold card, and the default post-login landing (no `returnTo`) is «Мои события»
(`/account/events`) instead of the `/account` session dump. The guard-validated
`?returnTo=/webinars/:slug` registration-resume path is unchanged.
