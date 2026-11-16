import {
  Body,
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
} from "@nestjs/common";
import { Authz, Public } from "../../authz/index.js";
import { TelegramFeedSource, updateIdOf } from "./telegram.feed-source.js";

// 048 EARS-24, EARS-25 (#3994) — `POST /v1/integrations/telegram/webhook`,
// Telegram's ingress (ADR-0011 §2.2 channel #10). Anonymous for the
// platform's auth: the `X-Telegram-Bot-Api-Secret-Token` header is its
// credential, checked by `TelegramWebhookMiddleware` before the body is read
// (404 while unconfigured, 401 on a wrong secret). Every processed or dropped
// update answers 200; our own failure answers 500 — with a log line carrying
// no payload (EARS-36) — so Telegram delivers it again.

@Controller({ path: "integrations/telegram", version: "1" })
export class TelegramWebhookController {
  private readonly logger = new Logger("TelegramWebhook");

  // Explicit @Inject token — the root-level authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(TelegramFeedSource) private readonly feed: TelegramFeedSource,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  @Public()
  @Authz({
    access: "public",
    check: "none",
    audit: "low-stakes",
    tests: ["EARS-24", "EARS-25", "EARS-26", "EARS-27", "EARS-28", "EARS-36"],
  })
  async webhook(@Body() body: unknown): Promise<{ ok: true }> {
    try {
      await this.feed.receive(body);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "telegram_update_failed",
          updateId: updateIdOf(body),
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      throw new InternalServerErrorException();
    }
    return { ok: true };
  }
}
