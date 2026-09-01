---
"@ds/portal": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/api": minor
---

014 EARS-5: login-gated playback — the webinar archive page serves a source-free
public read plus a guest gate («просмотр бесплатен, нужен аккаунт») whose sign-in
action carries the EARS-6 return target, and mounts the recording player for an
authenticated doctor.

Bump letter — `minor` (additive, no break, per repo-conventions → Bump letter):
`@ds/schemas` and the regenerated `@ds/api-client` gain the new playback contract
without changing any existing export or field shape; `@ds/api` adds a new
authenticated endpoint `GET /v1/events/:idOrSlug/recordings` and leaves every
existing route's response untouched (the public read stays source-free); `@ds/portal`
adds a new user-visible capability to an existing page with no removed behaviour.
No migration in this slice.
