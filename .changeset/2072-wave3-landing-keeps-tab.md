---
"@ds/auth-flow": patch
---

The sign-in door's landing keeps the hybrid event page's tab (020 LD-9 / EARS-5, #2072): `resolveReturnLandingPath` re-homes `/webinars/<slug>?mode=offline|online` onto the host's event route with the validated tab, so a doctor who signs in from the Academy «Онлайн» tab lands back on it instead of the default «Очно».
