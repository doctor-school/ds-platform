---
"@ds/portal": minor
---

005 EARS-5 — registered-doctor join signposting on the webinar event page. For a
registered doctor the page now signposts how/when they join, layered on the 004
lifecycle CTA: `upcoming` shows the broadcast start (date/time МСК) + a «вы
записаны» confirmation replacing the register CTA; `live` shows the confirmation

- an obvious onward path to the room (feature 006 route). Built to the vendored
  `webinar-page.dc.html` registered states from `@ds/design-system` tokens (EARS-13),
  with МСК presentation and no viewer-local drift (EARS-11).
