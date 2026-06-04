import { SetMetadata } from "@nestjs/common";
import { RATE_LIMITED_KEY } from "./rate-limit.types.js";

/**
 * `@RateLimited()` — opt a handler into the EARS-13 auth rate limiter.
 *
 * The global {@link RateLimitGuard} no-ops on any handler without this metadata,
 * so the gate is additive (mirrors `@BotProtected`): the abuse-prone auth
 * endpoints (register, login, OTP-request, reset) mark themselves and the guard
 * then enforces per-user / per-IP / per-ASN ceilings. Authenticated,
 * session-bound routes (session/refresh/logout) are intentionally not marked —
 * they are already gated by holding a valid session, not by identifier rate.
 */
export function RateLimited(): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMITED_KEY, true);
}
