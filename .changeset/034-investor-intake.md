---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

034 investor kind: `POST /v1/public/applications/investor` (guest, bot-protected, idempotent) stores the Academy «Инвесторам» requests in the application queue with the consent `investor-request-personal-data` on the row, and sends the 033 team notice and «Заявка получена» receipt to the work email.
