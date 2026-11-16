---
"@ds/api": minor
---

#3995: 048 one-off Telegram channel history import — `pnpm --filter @ds/api telegram:import-history -- --source t.me/<address> --export <folder>/result.json` validates a Telegram Desktop «Export chat history» JSON of the source's bound channel as a whole (refusing, with nothing written and exit 1, an unparsable file, a non-channel export, another channel or a source with no bound Telegram id), then writes one `post` entry per exported text post under the webhook's mapping, its preview from the exported photo or video thumbnail; a message already held is skipped, so a re-run or a webhook-delivered post is never duplicated. Prints the counts read, written, skipped as existing, skipped as media with no text, dropped by reason and previews failed.
