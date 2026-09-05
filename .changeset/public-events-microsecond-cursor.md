---
"@ds/api": patch
---

014 EARS-11 — `GET /v1/public/events` paged on a cursor encoded from the
millisecond `Date` node-postgres returns, while `events.starts_at` is
`timestamptz` and stores microseconds. The truncated cutoff was strictly EARLIER
than the instant it came from, so the row that issued the cursor satisfied the
keyset predicate again and the next page served it once more — a non-terminating
page loop on a zero-auth route for any event whose `starts_at` carries
sub-millisecond digits. The listing now reuses the shared
`public-event-cursor` module (#1294): the cursor carries the instant exactly as
Postgres renders it and the comparison casts that text straight back to
`timestamptz`, in both the ascending («Предстоящие») and the descending
(«Прошедшие») direction. The cursor is opaque by contract and the response shape
is unchanged; cursors issued by the previous build are refused with the same 400.
