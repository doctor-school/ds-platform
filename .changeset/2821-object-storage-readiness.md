---
"@ds/api": minor
"@ds/schemas": major
---

`GET /v1/ready` now also reports `checks.objectStorage`: the api checks the uploads bucket at startup and every 60 seconds, so a stale or revoked storage key shows as `down` (HTTP 503) and a single warning log with the store's reason (`InvalidAccessKeyId (HTTP 403)`) instead of staying invisible until an upload fails. Storage write and delete errors now carry that same readable reason in place of `UnknownError`. `GET /v1/health` is unchanged. A prod deploy or rollback onto a store that refuses the key now ends red at the smoke step, naming `objectStorage=down` (#2821).
