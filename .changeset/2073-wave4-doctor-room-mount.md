---
"@ds/doctor": patch
---

The doctor storefront's live room `/events/:slug/room` mounts `@ds/room-page` (#2073, wave-4 PR 4.4), the one room route the Academy already mounts; the doctor room glue is deleted. In the room header the initials chip now links to the personal account `/account`, and presence / unread counts of 1000 and more are written with a thousands space («1 000»).
