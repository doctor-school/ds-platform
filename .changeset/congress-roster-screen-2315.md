---
"@ds/admin": minor
---

Add the congress roster screen to admin (044 EARS-21, #2315): `/events/:id/roster` shows one event's registrations on the `AdminDataList` composition — instant search and server paging over `GET /v1/admin/events/:idOrSlug/roster`, columns in the EARS-25 order (№, ФИО, специальность, место работы, город, область, телефон, email, дата регистрации, статус письма), answer-less cells rendered empty. View-only: no create, no row link, no lifecycle filter. The event detail page links to it as «Реестр участников». Sort, per-column filters, print and the registrar's navigation are later handlers.
