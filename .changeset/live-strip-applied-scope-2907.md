---
"@ds/events-storefront": major
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

The doctor «Идёт сейчас» strip follows the applied specialty scope, the same
one the feed below it reads (019 «Amendment — 2026-10-13», #2907), so it no
longer shows on a page load and then vanishes on its first refresh.

`GET /v1/storefront/doctor/events/live` takes an optional `specialty` query
(`mine-and-adjacent` by default, `all`, or a pick), decoded by the new
`parseDoctorEventsLiveQuery` in `@ds/schemas`. In `@ds/events-storefront`,
`fetchEventsLive(liveHref, config, session, request)` now carries the guest's
remembered-specialty relay cookie like the feed read (breaking signature
change); `LiveSection` takes the page's `raw` query and `request`; the server
render and the client refresh read the one href built by `liveReadHref`, the
block is keyed by it, and a new server answer replaces the held one.
