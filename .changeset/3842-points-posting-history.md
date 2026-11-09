---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

The doctor's attention-points posting history (025 EARS-46, #3842): `GET /v1/me/points/postings?cursor=&limit=` answers `PostingHistory` — every posting on the caller's own account, newest first by (`occurred_at`, `id`), with a signed amount (credit +, debit −), the fact type as `action`, the content ref, rule id and version and `reversesPostingId` on a reversal; no attribution field and no other person's identifier. Cursor-paginated (`limit` 1–100, default 50, `POINTS_POSTING_HISTORY_LIMIT`); an out-of-range query is refused with problem `points-history-query-invalid` (400). `@ds/schemas` adds `PointsPostingHistorySchema` and its item/query schemas.
