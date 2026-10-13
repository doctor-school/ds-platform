---
"@ds/events-storefront": minor
"@ds/doctor": patch
"@ds/portal": patch
---

Events page «Повторить» re-reads only the failed block (019 EARS-9, #2832): the month grid, the day feed and «Мои события» each retry through the host's block-retry server action (`@ds/events-storefront/retry`, `renderEventsBlock`), which re-runs that block's read alone and re-renders that block in place — no route refresh re-reading every block. `EventsListingPage` takes the action as its required `retry` prop; both hosts wire theirs.
