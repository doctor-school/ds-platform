---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
---

048 materials feed (#3512): the `materials` and `feed_entries` tables (migration `0055_materials_feed`, 010 audit triggers, `first_published_at` and the slug pinned once published), the material authoring contract (`CreateMaterialRequestSchema`, `UpdateMaterialRequestSchema`, `AdminMaterialListQuerySchema`, `MaterialAdminDetailSchema`, `MaterialAdminListSchema`, `materialPublishMissing`) and the «Материалы» admin API — `GET/POST /v1/admin/materials`, `GET/PATCH /v1/admin/materials/{id}`, `POST /v1/admin/materials/{id}/publish` and `/unpublish` — where a publish, an edit of a published material and an unpublish write or remove the material's feed entry in the same transaction. The material cover is the 012 media slot `materials.cover_ref`: multipart `cover` part on create / edit (normalized WebP under a server-generated key), `mediaAction: "clear"` on edit, the released object handed to `media_cleanup_jobs` (`media_entity_kind` gains `material`, migration `0056_media_entity_kind_material`), and the slot registered with the 012 media-slot registry so neither media sweep deletes a live cover.
