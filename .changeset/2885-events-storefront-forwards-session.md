---
"@ds/events-storefront": patch
---

#2885: on the doctor host the server reads of the events feed, the month view and the month counts forward a signed-in doctor's session to the api (the same session hop the «Идёт сейчас» read uses), so a doctor with a profile specialty and no specialty cookie sees the feed targeted on «моя и смежные» (019 EARS-3). A guest's reads and every Academy read are unchanged; all of them stay uncached.
