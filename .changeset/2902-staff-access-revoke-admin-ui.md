---
"@ds/admin": minor
---

Staff access revocation (047 EARS-7, EARS-8): every «Доступы» row gets «Отозвать», which opens the confirmation «Отозвать доступ: <ФИО> — <роль>?» naming the event for a congress role. On success the row disappears and the person's open admin session ends; when the revocation fails the dialog stays open with the reason and «Повторить»; the caller's own platform-administrator role is refused by name. A second factor older than the step-up window sends the revocation through the code screen and back to «Доступы», where it is sent once. The data provider now accepts a `204 No Content` answer to an admin command.
