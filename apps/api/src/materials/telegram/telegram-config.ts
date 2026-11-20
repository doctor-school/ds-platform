import { loadEnv } from "../../config/env.schema.js";

/**
 * 048 slice 2 (ADR-0011 §2.2 channel #10, EARS-24, EARS-36) — the Telegram
 * connector's server-side configuration. `null` while the bot token is unset:
 * the connector is off (the kill switch) — no update poller runs and nothing
 * calls the Bot API. The token lives only in this object; it is never logged,
 * returned or stored.
 */
export interface TelegramConfig {
  botToken: string;
}

/** DI token: the {@link TelegramConfig}, or `null` when the connector is off. */
export const TELEGRAM_CONFIG = Symbol("TELEGRAM_CONFIG");

export function telegramConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | null {
  const botToken = loadEnv(env).TELEGRAM_BOT_TOKEN;
  return botToken ? { botToken } : null;
}
