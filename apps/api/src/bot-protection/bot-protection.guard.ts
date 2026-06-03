import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { BOT_PROTECTION } from "./bot-protection.tokens.js";
import {
  BOT_PROTECTED_KEY,
  type BotProtection,
  type BotProtectionAction,
} from "./bot-protection.types.js";

/** Header carrying the SmartCaptcha widget token (lower-cased by Fastify). */
export const BOT_PROTECTION_TOKEN_HEADER = "x-smartcaptcha-token";
/** Body field the widget token falls back to when no header is present. */
export const BOT_PROTECTION_TOKEN_FIELD = "captchaToken";

/** Minimal request shape the guard reads (Fastify populates `ip`). */
interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  ip?: string;
}

/**
 * Global bot-protection gate (design §10.1).
 *
 * It runs on every route but **only acts on handlers marked `@BotProtected`** —
 * an unmarked handler returns `true` immediately, so the guard is additive and
 * touches no existing call site. For a marked handler it pulls the widget token
 * (header first, then body), reads the client IP, and delegates to whatever
 * provider is bound to {@link BOT_PROTECTION}. A missing or provider-rejected
 * token is a generic `ForbiddenException`; the specific reason stays in the
 * provider result for the audit ledger and never reaches the client (EARS-16).
 *
 * Swappability: the guard depends on the {@link BotProtection} interface by
 * token only, so replacing the Yandex adapter (DSO-26) is a module-level rebind
 * with no change here or at any decorated endpoint.
 */
@Injectable()
export class BotProtectionGuard implements CanActivate {
  constructor(
    @Inject(BOT_PROTECTION) private readonly provider: BotProtection,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<
      BotProtectionAction | undefined
    >(BOT_PROTECTED_KEY, [context.getHandler(), context.getClass()]);

    // Not bot-protected — no-op.
    if (!action) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new ForbiddenException("bot-protection challenge required");
    }

    const result = await this.provider.verify(token, action, request.ip ?? "");
    if (!result.ok) {
      throw new ForbiddenException("bot-protection challenge failed");
    }
    return true;
  }

  private extractToken(request: GuardRequest): string | undefined {
    const header = request.headers?.[BOT_PROTECTION_TOKEN_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (fromHeader) return fromHeader;

    const fromBody = request.body?.[BOT_PROTECTION_TOKEN_FIELD];
    return typeof fromBody === "string" && fromBody ? fromBody : undefined;
  }
}
