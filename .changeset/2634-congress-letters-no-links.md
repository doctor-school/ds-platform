---
"@ds/api": minor
---

Congress letters carry no links (046 EARS-14 / EARS-15 amended, #2634). The
submission receipt drops its «Мои заявки на Конгресс» action and instead tells
in text how to reach the cabinet from the congress site; the 044 confirmation
letter (site form and desk) gains one such line. `orthobio.ru` is plain text in
both parts, never a link. With no letter linking to the doctor storefront, the
api no longer reads `MAILER_DOCTOR_BASE_URL`: the key is no longer required at
boot, and a leftover line in an env file is ignored.
