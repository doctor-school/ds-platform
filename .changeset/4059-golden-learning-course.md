---
"@ds/db": patch
"@ds/e2e": patch
---

#4059: the golden seed carries one published learning course (`golden.learning.course`, slug `golden-course-path`): a school, two modules, lesson 1 video → download → exit test and lesson 2 video → exit test, «Путь (Duolingo)» applied on the course from the preset row migration 0065 inserts, and the download's PDF in the golden media plan. The stage route walk resolves `/courses/[courseSlug]` and `/courses/[courseSlug]/steps/[stepId]` (a route-params entry may now answer each segment by name), and the `live/doctor/learning` leg runs on a slot with the seeded slug.
