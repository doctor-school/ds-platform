---
"@ds/portal": patch
---

fix(portal): the logged-in «Участвовать» one-tap CTA now registers via a real
`<form>` + server action, so it works before hydration — on a weak network where
the JS bundle is slow or fails to load, the button is no longer dead. The hydrated
path keeps today's in-place one-tap (client POST + `router.refresh()`, no
navigation); both arms are server-side idempotent (005 EARS-1/EARS-3).
