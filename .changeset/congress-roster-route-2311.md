---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": patch
---

Add the roster HTTP route over the event read model (044 EARS-18, #2311): `GET /v1/admin/events/:idOrSlug/roster` answers a paged, instant-searchable page of the registrar's desk roster — ФИО, specialty name, место работы, город, область, телефон as typed, email, registration instant and the confirmation-letter outcome — authorized for `event-registrar` and `platform_admin` on its own controller. It is a second, widened read (`eventRosterPage`) beside the PII-free `eventRoster()` the room gate consumes, which is unchanged. Query state is the `AdminDataList` baseline (`q`, `page`, `pageSize`) only; sorting, per-column filters and the «возможный дубль» marker on this row are EARS-22/23/30/31.
