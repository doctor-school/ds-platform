import { SetMetadata } from "@nestjs/common";
import {
  BOT_PROTECTED_KEY,
  type BotProtectionAction,
} from "./bot-protection.types.js";

/**
 * `@BotProtected(action)` — opt a handler into bot-protection verification.
 *
 * The global {@link BotProtectionGuard} no-ops on any handler that lacks this
 * metadata, so the gate is additive: an abuse-prone endpoint (registration,
 * reset, post-failure login — EARS-17) marks itself with `@BotProtected("…")`
 * and the guard then requires a valid provider token. Endpoints without the
 * decorator are unaffected, which is why adding a new provider behind the
 * {@link BOT_PROTECTION} token never touches a call site.
 */
export function BotProtected(
  action: BotProtectionAction,
): MethodDecorator & ClassDecorator {
  return SetMetadata(BOT_PROTECTED_KEY, action);
}
