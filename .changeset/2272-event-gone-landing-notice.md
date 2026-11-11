---
"@ds/auth-flow": patch
"@ds/doctor": patch
"@ds/events-storefront": patch
"@ds/portal": patch
---

#2272: a doctor whose эфир no longer exists, landed on the default page after confirming the code or signing in, now reads a one-time line on that page saying the эфир is no longer available and what the page offers instead — on the doctor storefront's home and specialty feed and on the Academy listing. The line is shown once: the address loses its marker after the first render, so a reload does not repeat it.
