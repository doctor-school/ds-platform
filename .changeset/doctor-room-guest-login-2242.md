---
"@ds/doctor": patch
"@ds/room": patch
---

020 EARS-7 (#2242): a guest who opens a doctor-storefront room URL `/events/<slug>/room` is now redirected to this host's `/login?returnTo=%2Fevents%2F<slug>%2Froom` instead of the event page, and signing in lands them back in the room where the entry gate re-runs — the same door the Academy room uses. The `@ds/room` return codec now validates a room return against the host's own event-page shape (`/webinars/<slug>` or `/events/<slug>`), and the doctor auth-flow config states `room: "/events/:slug/room"`.
