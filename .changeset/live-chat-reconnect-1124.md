---
"@ds/portal": patch
---

fix(room): the live chat survives a full webinar instead of falling back to the empty-state ~78 min in (#1124). A dropped or terminated Centrifugo connection is now truthful — a transient drop shows a reconnecting banner while the SDK retries, a terminal disconnect prompts a reload — and an established conversation is never silently replaced by «Пока нет сообщений». Paired with raising the Centrifugo `room` history retention to span a full webinar + margin (both dev-stand and prod configs), a mid-webinar reload/resubscribe hydrates the recent conversation instead of an empty pane over a live room.
