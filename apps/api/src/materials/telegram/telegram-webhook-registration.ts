import {
  TELEGRAM_ALLOWED_UPDATES,
  type TelegramBotApi,
} from "./telegram-bot-api.types.js";
import type { TelegramConfig } from "./telegram-config.js";

// 048 EARS-24 (#3994) — the operator's webhook registration: `setWebhook`
// with the environment's public `TELEGRAM_WEBHOOK_URL`, the configured
// `secret_token` and `allowed_updates = ["channel_post",
// "edited_channel_post"]`, then `getWebhookInfo` to report what Telegram
// holds. Run by `scripts/telegram-set-webhook.ts`. The result names the URL
// and the update types only — never the token or the secret (EARS-36).

export interface WebhookRegistrationResult {
  registered: true;
  url: string;
  allowedUpdates: string[];
  pendingUpdateCount: number;
}

export class WebhookRegistrationRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebhookRegistrationRefused";
  }
}

export async function registerTelegramWebhook(
  config: TelegramConfig | null,
  api: TelegramBotApi,
): Promise<WebhookRegistrationResult> {
  if (config === null) {
    throw new WebhookRegistrationRefused(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set",
    );
  }
  if (config.webhookUrl === null) {
    throw new WebhookRegistrationRefused("TELEGRAM_WEBHOOK_URL must be set");
  }
  await api.setWebhook({
    url: config.webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
    drop_pending_updates: false,
  });
  const info = await api.getWebhookInfo();
  return {
    registered: true,
    url: info.url,
    allowedUpdates: info.allowed_updates ?? [],
    pendingUpdateCount: info.pending_update_count,
  };
}
