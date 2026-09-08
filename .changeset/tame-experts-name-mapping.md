---
"@ds/api": patch
---

012 EARS-20 (#1607): migration 0028 carries the reviewed per-id Expert name mapping. Its coverage guard now fails closed on a retained `experts` row outside the reviewed mapping instead of on any retained row at all, and backfills `family_name` / `given_name` / `patronymic` for the covered rows before the structured-name constraint is added. A mapping id absent from the table is not an error. No parser: 012 §LD-10 makes existing Expert names reviewed data, never parsed input.
