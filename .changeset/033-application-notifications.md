---
"@ds/api": minor
---

033 notifications: every committed application sends the team notice (kind, time, admin link) to each active `platform_admin` and the «Заявка получена» receipt to the kind's recipient after the commit, recording `sent` / `failed` / `skipped` / `not_applicable` on the row without changing the intake's answer.
