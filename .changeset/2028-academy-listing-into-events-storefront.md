---
"@ds/events-storefront": minor
"@ds/portal": patch
---

The Academy events listing (week pane, month pane, list router, page head and the listing href builder) moves into the package behind `./listing` (`EventsListingPage`) and `./host-config` (`EventsStorefrontHostConfig`); `/webinars` mounts it with the Academy host config. No behaviour change.
