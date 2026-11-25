---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

033 partnership kind: `POST /v1/public/applications/partnership` (guest, bot-protected, idempotent) stores the Academy home's partnership requests in the application queue; `applications:import-partnership` imports the interim form's stored records once, marked `imported` so no team notice goes out for them.
