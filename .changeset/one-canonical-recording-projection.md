---
"@ds/schemas": minor
"@ds/api": minor
---

014 EARS-3 — one canonical edited-over-raw recording projection. `@ds/schemas`
gains the source-free `RecordingProjectionSchema` (`state: montage | raw-only | preparing`,
`primaryKind`, `secondaryKind`, `posterUrl`, `expectedBy`) plus `RecordingStateSchema`;
`@ds/api` gains `RecordingsProjectionService`, exported by `RecordingsModule` as the
single place the display rule lives. The primary/secondary choice is derived on every
read from the published, non-retired rows alone — no ordering column is stored, so
publishing the montage later promotes it with no operator edit — and the batch form
resolves a whole listing page in one statement.
