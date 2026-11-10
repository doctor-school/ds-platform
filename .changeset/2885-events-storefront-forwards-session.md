---
"@ds/events-storefront": major
---

#2885: the server reads of the events feed, the month view and the month counts can forward a signed-in viewer's session to the api, so a doctor with a profile specialty and no specialty cookie sees the feed targeted on «моя и смежные» (019 EARS-3, 017 LD-2). Breaking for hosts and callers: the exported `ReadRequest` (`./server`) gains the required `userAgent` and `acceptLanguage` fields, which changes the signatures of `fetchEventsFeed`, `fetchMonthEntries` and `fetchMonthCounts` (build it with `readRequestFrom`). New host-config field `contentSet.forwardSession: true` switches session forwarding on; a host that leaves it unset (the Academy) keeps relaying only `contentSet.relayCookie` and the client address. Every such read stays `no-store`.
