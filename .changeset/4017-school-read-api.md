---
"@ds/learning": minor
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/api-client": minor
---

#4017: the school and the course header data (023) — backend. Migration `0067_023_school_course_data` adds the school's description, «О школе» facts, «скоро» note, community link and mentoring / internship offers, and the course's description, academic hours, document, prerequisites, partner organisation and position in its school; the 024 admin creates accept them. New public read `GET /v1/learning/schools/{schoolSlug}` answers a published school with its courses in school order and, for a signed-in doctor, each course's state; the course path read carries the course data and the rules summary, and the lesson read the lesson's first step. The golden school is published with its data.
