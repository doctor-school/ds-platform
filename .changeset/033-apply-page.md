---
"@ds/applications": minor
"@ds/portal": minor
"@ds/auth-flow": minor
"@ds/legal-content": minor
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

033 EARS-1…5, 8, 9, 10: the Academy page «Заявка автора» at `/apply` — a guest gets the account gate «Войти / Регистрация» that returns to the open form after sign-in or registration; a signed-in expert sends topic, specialty, format, about and consent once per tap (a server failure keeps the input and retries with the same key), sees «Заявка отправлена», and on a later visit «Ваша предыдущая заявка в работе» from `GET /v1/me/applications?kind=author`.
