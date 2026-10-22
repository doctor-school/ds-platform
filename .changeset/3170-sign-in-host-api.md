---
"@ds/api": minor
"@ds/schemas": minor
"@ds/db": minor
"@ds/api-client": minor
---

The sign-in host's API (003 EARS-5/24/44/60/64/66–71, ADR-0015 §4, #3170):
`/v1/sign-in-host/*` reads a Zitadel auth request, picks the storefront by
`client_id`, runs the storefront's own sign-in, code, registration and reset
steps under the same guards, and keeps one shared browser session per browser
(`sign_in_host_records`, sealed at rest, 30-day lifetime, 7-day idle). Revoking
every session of a person (reset, first verification) now also ends their
sign-in-host records. Disabled (404) until the whole configuration block is set.
