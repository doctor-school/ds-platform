---
"@ds/api-client": major
---

#2885: regenerated. The doctor events reads (`GET /v1/storefront/doctor/events`, `…/month`, `…/month-counts`, `…/live`) no longer declare a required `cookie` header parameter: their generated `operations[…].parameters.header` changed from `{ cookie: string }` to `never`, so a typed caller that passes that header no longer compiles. The cookie still travels as an ordinary request cookie.
