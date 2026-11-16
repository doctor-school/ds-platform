import { describe, expect, it } from "vitest";
import { FakeTelegramBotApi } from "./telegram-bot-api.fake.js";
import {
  registerTelegramWebhook,
  WebhookRegistrationRefused,
} from "./telegram-webhook-registration.js";

const TOKEN = "123456:unit-bot_token";
const SECRET = "unit_webhook-secret";
const URL = "https://api.example.test/v1/integrations/telegram/webhook";

describe("048 Telegram webhook registration", () => {
  it("048 EARS-24: when an operator runs the webhook registration command, the system shall call setWebhook with the public webhook URL, the configured secret_token and allowed_updates channel_post + edited_channel_post", async () => {
    const api = new FakeTelegramBotApi();
    const result = await registerTelegramWebhook(
      { botToken: TOKEN, webhookSecret: SECRET, webhookUrl: URL },
      api,
    );
    expect(api.calls.map((c) => c.method)).toEqual([
      "setWebhook",
      "getWebhookInfo",
    ]);
    expect(api.calls[0]!.args[0]).toEqual({
      url: URL,
      secret_token: SECRET,
      allowed_updates: ["channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });
    expect(result).toEqual({
      registered: true,
      url: URL,
      allowedUpdates: ["channel_post", "edited_channel_post"],
      pendingUpdateCount: 0,
    });
    // EARS-36 — the printed result carries neither the token nor the secret.
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain(SECRET);
  });

  it("048 EARS-24: when the connector or its public URL is not configured, the registration command shall refuse and call nothing", async () => {
    const api = new FakeTelegramBotApi();
    await expect(registerTelegramWebhook(null, api)).rejects.toBeInstanceOf(
      WebhookRegistrationRefused,
    );
    await expect(
      registerTelegramWebhook(
        { botToken: TOKEN, webhookSecret: SECRET, webhookUrl: null },
        api,
      ),
    ).rejects.toThrow("TELEGRAM_WEBHOOK_URL must be set");
    expect(api.calls).toEqual([]);
  });
});
