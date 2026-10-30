---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

048 materials feed (#3512): the `materials` and `feed_entries` tables (migration `0055_materials_feed`, 010 audit triggers, `first_published_at` and the slug pinned once published), the material authoring contract (`CreateMaterialRequestSchema`, `UpdateMaterialRequestSchema`, `AdminMaterialListQuerySchema`, `MaterialAdminDetailSchema`, `MaterialAdminListSchema`, `materialPublishMissing`) and the «Материалы» admin API — `GET/POST /v1/admin/materials`, `GET/PATCH /v1/admin/materials/{id}`, `POST /v1/admin/materials/{id}/publish` and `/unpublish` — where a publish, an edit of a published material and an unpublish write or remove the material's feed entry in the same transaction.
