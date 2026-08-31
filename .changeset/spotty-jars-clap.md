---
"@ds/api": minor
"portal": minor
---

014 EARS-9 — «Мои события» carries two tabs over the full registration history

`GET /v1/me/events` now takes `?tab=upcoming|recordings` and answers with an
envelope (`{ tab, data, counts }`) instead of a bare array: one tab of rows plus
BOTH tabs' counts, so a surface can label the un-selected tab without a second
read. «Предстоящие» keeps the shipped nearest-first order over the registered
`published`/`live` events; «Записи» is the doctor's FULL `ended` history,
newest-first, each row badged with its recording state — an ended event whose
recording is not published yet still appears, badged «Запись готовится», so an
эфир a doctor attended is never lost. `archived` events appear in neither tab; an
unknown tab is a 400.

The `/account/events` surface renders both tabs through the shared `EventList`
block, with the tab as deep-linkable URL state (`?tab=recordings`).
