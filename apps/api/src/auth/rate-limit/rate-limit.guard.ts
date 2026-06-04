import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitService } from "./rate-limit.service.js";
import { RATE_LIMITED_KEY } from "./rate-limit.types.js";

/** One generic throttled message — names no threshold, no account (EARS-13/16). */
const GENERIC_THROTTLED = "too many requests, please try again later";

/** Header carrying the edge-resolved ASN (lower-cased by Fastify); absent in dev. */
const ASN_HEADER = "x-asn";

/** Minimal request shape the guard reads (Fastify populates `ip`). */
interface GuardRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}

/**
 * Global EARS-13 rate-limit gate (ADR-0001 §7).
 *
 * Runs on every route but **only acts on handlers marked `@RateLimited`** (an
 * unmarked handler returns `true` immediately, so the guard is additive and
 * touches no other call site — the same pattern as `BotProtectionGuard`). For a
 * marked handler it derives the per-user key (the submitted identifier), the
 * per-IP key, and the per-ASN key, then asks {@link RateLimitService}. A refusal
 * is a generic `429` that reveals neither the breached dimension nor whether the
 * account exists (EARS-16).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      RATE_LIMITED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!marked) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const allowed = this.limiter.tryConsume({
      ip: request.ip ?? "",
      identifier: this.extractIdentifier(request),
      asn: this.extractAsn(request),
    });
    if (!allowed) {
      throw new HttpException(GENERIC_THROTTLED, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  /** The submitted identifier the per-user window keys on (login/reset/otp use `identifier`; register uses `email`/`phone`). */
  private extractIdentifier(request: GuardRequest): string | undefined {
    const body = request.body ?? {};
    const candidate = body["identifier"] ?? body["email"] ?? body["phone"];
    return typeof candidate === "string" && candidate ? candidate : undefined;
  }

  private extractAsn(request: GuardRequest): string | undefined {
    const raw = request.headers?.[ASN_HEADER];
    const asn = Array.isArray(raw) ? raw[0] : raw;
    return asn && asn.length > 0 ? asn : undefined;
  }
}
