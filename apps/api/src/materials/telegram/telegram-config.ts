import { loadEnv } from "../../config/env.schema.js";

/**
 * 048 slice 2 (ADR-0011 §2.2 channel #10, EARS-24, EARS-36) — the Telegram
 * connector's server-side configuration. `null` while the bot token or the
 * webhook secret is unset: the connector is off (the kill switch) — the
 * webhook answers 404 and nothing calls the Bot API. The values live only in
 * this object; they are never logged, returned or stored.
 */
export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
  /** The public webhook URL `setWebhook` registers; null when unset. */
  webhookUrl: string | null;
}

/** DI token: the {@link TelegramConfig}, or `null` when the connector is off. */
export const TELEGRAM_CONFIG = Symbol("TELEGRAM_CONFIG");

export function telegramConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | null {
  const parsed = loadEnv(env);
  const botToken = parsed.TELEGRAM_BOT_TOKEN;
  const webhookSecret = parsed.TELEGRAM_WEBHOOK_SECRET;
  if (!botToken || !webhookSecret) return null;
  return {
    botToken,
    webhookSecret,
    webhookUrl: parsed.TELEGRAM_WEBHOOK_URL ?? null,
  };
}
