import { SetMetadata } from "@nestjs/common";
import {
  RATE_LIMITED_KEY,
  type RateLimitDoor,
  type RateLimitedMarker,
} from "./rate-limit.types.js";

/**
 * `@RateLimited()` — opt a handler into the EARS-13 auth rate limiter.
 *
 * The global {@link RateLimitGuard} no-ops on any handler without this metadata,
 * so the gate is additive (mirrors `@BotProtected`): the abuse-prone auth
 * endpoints (register, login, OTP-request, reset) mark themselves and the guard
 * then enforces per-user / per-IP / per-ASN ceilings. Authenticated,
 * session-bound routes (session/refresh/logout) are intentionally not marked —
 * they are already gated by holding a valid session, not by identifier rate.
 *
 * `scope` (#1646) is optional and changes nothing for the argument-less form:
 * omitted, the source-address windows key on the address alone, so every 003
 * verification door (login, code login, verify, reset-complete) consumes the ONE
 * shared budget EARS-13 intends (an attacker spraying identifiers across those
 * doors from a single origin meets a single ceiling of failed attempts). A consumer OUTSIDE that surface passes its own
 * tag and gets its own per-address bucket, so its traffic can neither exhaust
 * the auth budget nor be exhausted by it. A tag is a stable literal, not a
 * per-request value: it names the endpoint family, not the caller.
 *
 * `{ door: "sending" }` (#2684) marks a 003 auth door that SENDS (a code
 * request, register, resend, reset request, hand-off redemption): its per-IP
 * unit is counted in the sending doors' own window (60 / 15 min) instead of the
 * verification window, which the argument-less form keeps and whose successes
 * the handler refunds (`RateLimitService.refundIpUnit`).
 */
export function RateLimited(
  scopeOrDoor?: string | { door: RateLimitDoor },
): MethodDecorator & ClassDecorator {
  const marker: RateLimitedMarker = scopeOrDoor ?? true;
  return SetMetadata(RATE_LIMITED_KEY, marker);
}
