import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  BOT_PROTECTION,
  BOT_PROTECTION_TOKEN_FIELD,
  BOT_PROTECTION_TOKEN_HEADER,
  type BotProtection,
} from "../../bot-protection/index.js";
import { LoginChallengePolicy } from "./login-challenge.policy.js";
import { LOGIN_CHALLENGED_KEY } from "./login-challenge.types.js";

/** Minimal request shape the guard reads (Fastify populates `ip`). */
interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  ip?: string;
}

/**
 * EARS-17 conditional login-challenge gate (design §10.1).
 *
 * Runs on the login route (marked `@LoginChallenged`) and only *requires* a
 * bot-protection token once {@link LoginChallengePolicy} reports the origin has
 * failed N times — so a normal first login is unburdened, but a brute-force
 * origin must solve the same challenge as register/reset. The verification is
 * delegated to the shared {@link BotProtection} provider (disabled in dev → the
 * gate is inert there, exactly like `BotProtectionGuard`). A missing or rejected
 * token is a generic `ForbiddenException`; the reason stays provider-side for the
 * audit ledger and never reaches the client (EARS-16).
 *
 * Constructor ordering: the `@Inject` param precedes the type-inferred deps —
 * the tsx/esbuild `design:paramtypes` hazard the endpoint-authz gate trips on.
 */
@Injectable()
export class LoginChallengeGuard implements CanActivate {
  constructor(
    @Inject(BOT_PROTECTION) private readonly provider: BotProtection,
    private readonly policy: LoginChallengePolicy,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      LOGIN_CHALLENGED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!marked) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const ip = request.ip ?? "";
    // Not yet over the failure threshold — no challenge for a normal login.
    if (!this.policy.isChallenged(ip)) return true;

    const token = this.extractToken(request) ?? "";
    const result = await this.provider.verify(token, "login-challenge", ip);
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
