---
"@ds/db": minor
"@ds/api": minor
---

#3994: 048 Telegram connector — the `post` feed entry kind and the `feed_entry_messages` dedup table (migration `0063_telegram_connector`); `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_WEBHOOK_URL` (optional — unset, the connector is off); the Bot API client of ADR-0011 channel #10; `POST /v1/integrations/telegram/webhook` (secret checked before the body, 404 while off) turning channel posts, albums and edits into one feed entry each.

The preview of a photo or video post is copied into object storage (retried every 10 minutes with backoff for at least 24 h; migration `0064_telegram_preview_cleanup` adds the `feed_entry` media cleanup kind); the source check of EARS-31 runs hourly and at once on add / address edit / switch-on, binding the channel id; `pnpm --filter @ds/api telegram:set-webhook` registers the environment's webhook.
