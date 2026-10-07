import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RateLimitService } from "./rate-limit.service.js";
import {
  RATE_LIMITED_KEY,
  RATE_LIMIT_RECEIPT_KEY,
  type RateLimitReceipt,
  type RateLimitedMarker,
} from "./rate-limit.types.js";

/** One generic throttled message — names no threshold, no account (EARS-13/16). */
const GENERIC_THROTTLED = "too many requests, please try again later";

/** Header carrying the edge-resolved ASN (lower-cased by Fastify); absent in dev. */
const ASN_HEADER = "x-asn";

/** Minimal request shape the guard reads (Fastify populates `ip`). */
interface GuardRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  [RATE_LIMIT_RECEIPT_KEY]?: RateLimitReceipt;
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
 *
 * When the marker carries a scope tag (`@RateLimited("<tag>")`, #1646) the
 * source-address windows are partitioned under it, so that handler's traffic
 * cannot exhaust the auth surface's shared budget. The argument-less form is
 * unchanged: no tag, no partition. A `{ door: "sending" }` marker (#2684) keys
 * only the per-IP window under the sending doors' bucket.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const marked = this.reflector.getAllAndOverride<
      RateLimitedMarker | undefined
    >(RATE_LIMITED_KEY, [context.getHandler(), context.getClass()]);
    if (!marked) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const receipt = this.limiter.consume({
      ip: request.ip ?? "",
      identifier: this.extractIdentifier(request),
      asn: this.extractAsn(request),
      // `true` (the argument-less 003 form) leaves the source-address windows
      // keyed on the address alone — the shared auth budget, unchanged. A string
      // marker is the handler's own bucket tag (#1646).
      scope: typeof marked === "string" ? marked : undefined,
      // `{ door }` (#2684): a sending door counts in its own per-IP window.
      door: typeof marked === "object" ? marked.door : undefined,
    });
    if (receipt === null) {
      throw new HttpException(GENERIC_THROTTLED, HttpStatus.TOO_MANY_REQUESTS);
    }
    // EARS-13 (#2684): a succeeding verification refunds the unit taken here,
    // so the handler must know which per-IP window that unit came from.
    request[RATE_LIMIT_RECEIPT_KEY] = receipt;
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
