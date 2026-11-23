---
"@ds/learning": minor
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

Rules of a once-published course take the new staff role «Редактор правил обучения» (`learning_rules_editor`, 024 EARS-30, #4012); a draft course's rules stay with its editors. A change on such a course is previewed (how many doctors' statuses would change), keeps earned progress by default or requires it again, and is recorded once with its recompute (EARS-31); the doctor's lesson and path node carry the change's reason until the next completion (EARS-24). Unpublishing a course no longer frees its rules from the role: `learning_courses.first_published_at` is kept after an unpublish.
