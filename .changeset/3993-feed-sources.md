---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

#3993: 048 slice 2 source list — `feed_sources` with the slice-2 `feed_entries` columns and CHECKs (migration `0062_feed_sources`); the source contract normalizing `https://t.me/<имя>`, `t.me/<имя>`, `@<имя>`, `<имя>` to the lowercase username; `GET/POST /v1/admin/feed-sources`, `PATCH /v1/admin/feed-sources/{id}` (with the `href` rewrite) and `POST …/{id}/disable|enable` (with the entry marks in one transaction); the public feed excludes hidden and switched-off entries.
