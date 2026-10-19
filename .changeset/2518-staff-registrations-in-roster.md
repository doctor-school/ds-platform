---
"@ds/schemas": minor
"@ds/api": minor
"@ds/api-client": minor
"@ds/admin": patch
---

Staff are participants, not statistics (#2518): a staff account's registration now appears in the congress roster (`GET /v1/admin/events/:idOrSlug/roster` — rows, total and the «возможный дубль» population), and the roster takes `hideStaff=true` to leave staff out of all three. The admin roster's «Все фильтры» panel carries the «Скрыть сотрудников» switch (off by default, kept in the address, shown as a chip). The storefront sign-up count, the room's online count and presence minutes still exclude staff. `RegistrationService.eventRoster` / `RegistrationRepository.findEventRoster` take a required `{ excludeStaff }`.
