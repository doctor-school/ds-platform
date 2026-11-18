---
"@ds/doctor": minor
"@ds/learning": minor
"@ds/room": minor
"@ds/event-page": minor
---

#4011: the doctor's course path and step screens (024). `apps/doctor` mounts `/courses/[courseSlug]` (the path of steps with done / «Вы здесь» / open / locked-with-reason states, the node summary card or Sheet, breadcrumb and course author) and `/courses/[courseSlug]/steps/[stepId]` (video through the 014 recording player, download, exit test with the result against the threshold). `@ds/learning` adds `./client` and `./ui`; the recording player reports the provider's own playback clock (`onClock`; parsing for YouTube, Rutube and VK in `@ds/room/player-signals`; cdnvideo has no clock, #4055).
