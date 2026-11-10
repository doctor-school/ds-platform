---
"@ds/design-system": major
"@ds/event-page": patch
"@ds/auth-flow": patch
"@ds/db": patch
"@ds/doctor": patch
"@ds/portal": patch
"@ds/academy-demo": patch
"@ds/showcase": patch
---

Product copy on both storefronts no longer says «бесплатно» or who pays for the education. The doctor home hero, the footer note, the registration screen and the partner-data consent, the Academy «Что такое Doctor.School» cards and the golden-seed event descriptions drop the phrase. A zero Pul cost shows nothing: the event page has no «Участие» row and the event card has no cost chip; a positive cost still reads «N Pul». The event-page partner plate is headed by the partner-material mark «Партнёрский материал» instead of «При поддержке».

Breaking for `@ds/design-system`: `EVENT_PAGE_COPY.priceFree` / `EventPageCopy.priceFree`, the `WebinarCard` `freeLabel` prop and the `EventSignupCondition.tone` field are removed.
