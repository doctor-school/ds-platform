#!/usr/bin/env tsx
import { TelegramBotApiClient } from "../src/materials/telegram/telegram-bot-api.client.js";
import { telegramConfigFromEnv } from "../src/materials/telegram/telegram-config.js";
import { registerTelegramWebhook } from "../src/materials/telegram/telegram-webhook-registration.js";

/**
 * 048 EARS-24 (#3994) — register this environment's Telegram webhook: calls
 * `setWebhook` with `TELEGRAM_WEBHOOK_URL`, the configured
 * `TELEGRAM_WEBHOOK_SECRET` as `secret_token` and `allowed_updates =
 * ["channel_post", "edited_channel_post"]`, then prints what Telegram holds
 * (`url`, update types, pending count) — never the token or the secret.
 * One bot per environment (048 Lead decision 18): run it once per rollout
 * with that environment's API env injected:
 *
 *   pnpm --filter @ds/api telegram:set-webhook
 *
 * Exits non-zero on a refusal or a failed Bot API call.
 */
async function main(): Promise<void> {
  const config = telegramConfigFromEnv();
  const api = new TelegramBotApiClient(config?.botToken ?? null);
  const result = await registerTelegramWebhook(config, api);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    // The error's name and message only: a Bot API error never carries the
    // token (TelegramBotApiError names the method and outcome).
    process.stderr.write(
      `[telegram:set-webhook] FAILED — ${
        err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"
      }\n`,
    );
    process.exit(1);
  });
