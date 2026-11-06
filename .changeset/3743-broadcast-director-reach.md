---
"@ds/api": minor
"@ds/admin": minor
---

#3743 (049 EARS-7, EARS-8): the broadcast director («Режиссёр трансляций») reaches the admin events. The event list and card, create and edit, the stream config, the 007 lifecycle commands, the event's experts / projects / directions links and the dictionary reads those screens make admit `broadcast_director`; every other admin endpoint refuses it with `403`. In the admin a director without `platform_admin` sees «Мероприятия» alone, opens the event list, create form and card, and never sees the roster / intake / submissions links, the recordings tab, the «Архивный эфир» option or the legacy commands; any other route shows the refusal page.
