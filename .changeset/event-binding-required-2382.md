---
"@ds/api": patch
"@ds/admin": patch
---

A registrar refused by the event binding (044 EARS-38 — no binding, a withdrawn
or re-pointed one, another or an unknown event) now gets the stable
`403 EVENT_BINDING_REQUIRED` problem code instead of a codeless 403. The admin
desk side panel shows it as the «нет прав» refusal, never a retry; a desk answer that
arrives after the side panel was closed no longer leaves a stale line on the next
open. Across the admin, only a 401 signs the operator out: a 403 keeps the
session and the screen shows its refusal (ADR-0001 A1).
