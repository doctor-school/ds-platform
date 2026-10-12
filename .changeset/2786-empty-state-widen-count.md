---
"@ds/events-storefront": patch
"@ds/portal": patch
"@ds/doctor": patch
---

The empty state of the events page follows the canvas rule on both storefronts and in both views (019 EARS-9, #2786): it names the first applied filter whose removal finds events of the open tab — «Без этого фильтра найдётся N эфиров» (a picked specialty: «В вашей и смежных специальностях найдётся N событий») — counted by one feed read per filter, in the canvas order, stopping at the first that finds any; when no single removal helps it reads «По выбранным фильтрам … нет» with no widening. Every filtered empty state carries «Сбросить фильтры» beside the widening, which is the primary action; a picked specialty is named «Специальность: <name>»; only the storefront's own filters are counted. The month view names a filter by its title, not its URL slug.
