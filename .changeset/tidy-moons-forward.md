---
"@ds/events-storefront": major
"@ds/room": major
"@ds/portal": patch
"@ds/doctor": patch
---

Forward the client's `x-forwarded-for` on every SSR authed read (#2054).

Since #1655 the api runs behind `FastifyAdapter({ trustProxy })`, so `request.ip`
is the real browser taken from the forwarded chain and the BFF session
fingerprint (ADR-0001 §6) is bound to the BROWSER's IP/24. Every server-side read
from the Next containers built its own header set and dropped the chain, so the
api saw the container address (172.18.0.x), re-derived a different fingerprint and
401'd valid sessions — signed-in doctors were bounced off «Мои события» and the
event/room pages.

`ForwardedSession` gains a required `forwardedFor`, and one canonical
`forwardedSessionFrom` / `forwardedHeaders` pair in `@ds/events-storefront/server`
now builds every hop's headers (`@ds/room` mirrors it as `roomForwardedHeaders`
for its own structural `RoomSession`, which likewise gains the field). Both are
required-field additions to an exported interface, i.e. breaking for consumers.
