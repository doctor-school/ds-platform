---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/learning": minor
"@ds/admin": minor
---

023 EARS-26 / EARS-27 / EARS-28 (#4018): the school → course → module structure editor. Staff create a school by direction, leading expert and project, edit its data (facts up to four, «скоро», community, mentoring and internship offers), publish or unpublish it and order its courses; in a course they edit its data and partner, rename and order its modules and publish it once it holds a published lesson. New admin endpoints under the existing envelope: `PATCH /v1/admin/learning/schools/{id}`, `POST …/schools/{id}/publish|unpublish`, `PUT …/schools/{id}/course-order`, `PATCH …/courses/{id}`, `PUT …/courses/{id}/module-order`, `PATCH …/modules/{id}`.

A school republished while it already has a published course sends its pending «first course open» notices once (023 EARS-7).
