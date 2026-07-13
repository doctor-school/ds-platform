---
"@ds/portal": patch
---

fix: #843 live surfaces track lifecycle in real time — public event-page and upcoming-broadcasts SSR reads drop the 30s timer cache (`cache: "no-store"`; any future cache must be invalidated ON the lifecycle transition, never by timer), and the room-chat pane shows a distinct loading skeleton while the history bootstrap is in flight instead of flashing «Пока нет сообщений» over an active conversation
