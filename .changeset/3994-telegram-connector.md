---
"@ds/db": minor
"@ds/api": minor
---

#3994: 048 Telegram connector — the `post` feed entry kind and the `feed_entry_messages` dedup table (migration `0063_telegram_connector`); `TELEGRAM_BOT_TOKEN` (optional — unset, the connector is off and nothing is called); the Bot API client of ADR-0011 channel #10; a long poll of `getUpdates` (#4165 — the RF hosting network cannot receive a webhook) that runs in one API instance at a time under a Postgres advisory lock, deletes any webhook the bot had, retries a lost call with a backoff capped at 60 s, and advances its offset (`telegram_update_cursor`, migration `0066_telegram_update_cursor`) only past a processed or dropped update, turning channel posts, albums and edits into one feed entry each.

The preview of a photo or video post is copied into object storage (retried every 10 minutes with backoff for at least 24 h; migration `0064_telegram_preview_cleanup` adds the `feed_entry` media cleanup kind); the source check of EARS-31 runs hourly and at once on add / address edit / switch-on, binding the channel id, and reports «Telegram не может доставить новые посты» when the poller has answered no `getUpdates` within the hour.
