---
"@ds/schemas": minor
"@ds/db": minor
"@ds/portal": minor
"@ds/admin": minor
---

Add VK Video and CDNVideo to the webinar stream-provider enum end-to-end (#1134).

The closed `STREAM_PROVIDERS` enum grows from `rutube | youtube` to
`rutube | youtube | vk | cdnvideo` (all RU-reachable, embeddable providers),
additively across every layer that reads the SSOT:

- `@ds/schemas` — per-provider `EMBED_REF_SHAPES`: VK's `oid_id_hash` triple (the
  hash is mandatory and non-derivable) and CDNVideo's host-allowlisted player URL
  (`playercdn.cdnvideo.ru/aloha/players/`, an SSRF guard on the value the room
  drops into its `<iframe src>`). CDNVideo is the recorded stored-URL exception; the
  URL-shaped-paste guard is now provider-scoped so the id-style providers still
  reject a link.
- `@ds/db` — the Postgres `stream_provider` enum gains `vk` + `cdnvideo` via an
  additive `ALTER TYPE … ADD VALUE` migration.
- `@ds/portal` — the room resolves the VK `video_ext.php` embed from the triple and
  embeds the CDNVideo player URL verbatim; a provider-scoped direct watch URL is
  derived per provider.
- `@ds/admin` — ConfigureStream offers all four providers with a per-provider embed
  reference hint and provider-named RU validation errors.
