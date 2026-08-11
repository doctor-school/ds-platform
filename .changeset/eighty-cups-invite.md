---
"@ds/admin": minor
---

The admin login screen now tells an operator the truth when the identity service is
down. A 503 from `POST /v1/admin/auth/login` renders a warning alert («Сервис входа
временно недоступен…») instead of the wrong-credentials verdict, keeps the typed
email and password (they were never checked) and leaves the submit button active.
The uniform 401 refusal and the 429 throttling message are unchanged.
