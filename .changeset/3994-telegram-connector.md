---
"@ds/db": minor
"@ds/api": minor
---

#3994: 048 Telegram connector — the `post` feed entry kind and the `feed_entry_messages` dedup table (migration `0063_telegram_connector`); `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_WEBHOOK_URL` (optional — unset, the connector is off); the Bot API client of ADR-0011 channel #10; `POST /v1/integrations/telegram/webhook` (secret checked before the body, 404 while off) turning channel posts, albums and edits into one feed entry each.
