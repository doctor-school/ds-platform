---
"@ds/admin": patch
---

Fix the «Записи» panel white-screening on a failed read. The panel checked presence
against Refine's `result.data`, which substitutes a frozen `{}` when the query has no
answer — the check read "loaded" for a failed read and the render then tripped over
`list.eventState` / `list.data`. Presence now comes from the query itself
(`query.data?.data`), so a failed collection read renders the existing RU error alert
instead of a blank screen.
