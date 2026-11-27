---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/admin": minor
---

012 EARS-31: an expert's link to an event carries a required programme role `speaker | moderator` («Докладчик» / «Модератор»); the link's `role` becomes an optional caption, and the public speaker item carries it or `null`. The forward migration gives every existing link `speaker` and keeps every caption.

Admin: the «Привязать эксперта к мероприятию» dialog and its edit choose «Роль» from «Докладчик» / «Модератор» (no free text, nothing preselected), and the old role box becomes the optional «Подпись спикера», shown above the name; each link card shows both.
