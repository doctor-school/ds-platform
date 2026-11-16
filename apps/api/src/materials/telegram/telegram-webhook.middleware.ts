import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type NestMiddleware,
} from "@nestjs/common";
import { webhookSecretMatches } from "../../auth/webhook-secret.js";
import { TELEGRAM_CONFIG, type TelegramConfig } from "./telegram-config.js";

/** The header Telegram sends the `setWebhook` `secret_token` in. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * 048 EARS-24 (#3994) — the webhook's credential check. A route-scoped Nest
 * middleware runs in Fastify's `onRequest` phase, BEFORE the body is read or
 * parsed (a guard would run after the global JSON parser), so a refused
 * request is never parsed, processed or stored (048-design §Webhook):
 *   - connector not configured (no bot token or no webhook secret) → 404,
 *     the kill switch of ADR-0011 §2.2 channel #10;
 *   - header absent or different (constant-time compare) → 401.
 * Neither answer echoes the header or the secret (EARS-36).
 */
@Injectable()
export class TelegramWebhookMiddleware implements NestMiddleware {
  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig | null,
  ) {}

  use(req: IncomingMessage, _res: ServerResponse, next: () => void): void {
    if (!this.config) {
      throw new NotFoundException(`Cannot ${req.method ?? "POST"} webhook`);
    }
    const raw = req.headers[TELEGRAM_SECRET_HEADER];
    const presented = Array.isArray(raw) ? undefined : raw;
    if (!webhookSecretMatches(presented, this.config.webhookSecret)) {
      throw new UnauthorizedException();
    }
    next();
  }
}
